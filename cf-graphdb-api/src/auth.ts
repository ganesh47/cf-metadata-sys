// JWT validation using jose library with JWT_SECRET
// noinspection ExceptionCaughtLocallyJS

import {Env} from "./types/graph";
import {Logger} from "./logger/logger";
import {decodeProtectedHeader, importJWK, jwtVerify} from "jose";
import {matchRoute, routeMap} from "./routes";

const hasRequiredLevel = (userLevel: string, requiredLevel: string): boolean => {
	if (userLevel === '*') return true;

	const levels = ['read', 'write', 'audit'];
	const userLevelIndex = levels.indexOf(userLevel);
	const requiredLevelIndex = levels.indexOf(requiredLevel);
	if (userLevelIndex === -1 || requiredLevelIndex === -1) return false;
	return userLevelIndex >= requiredLevelIndex;
};

export const hasPermission = (permissions: string, orgId: string, requiredLevel: string): boolean => {
	if (!permissions) return false;

	const permissionScopes = permissions.split(',');

	for (const scope of permissionScopes) {
		const [scopeOrg, level] = scope.split(':');

		// Check for global wildcard permission
		if (scopeOrg === '*' && level === '*') return true;

		// Check for org wildcard permission with a sufficient level
		if (scopeOrg === '*' && hasRequiredLevel(level, requiredLevel)) return true;

		// Check for exact org with sufficient level
		if (scopeOrg === orgId && hasRequiredLevel(level, requiredLevel)) return true;
	}

	return false;
};

let cachedOidc: any = null
let cachedJwks: any = null
let lastJwksFetch = 0

export async function authenticate(
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>,
	params?: Record<string, string>
): Promise<Response> {
	let token: string | undefined;
	const authHeader = request.headers.get('Authorization');
	if (authHeader?.startsWith('Bearer ')) {
		token = authHeader.split(' ')[1];
	} else {
		const cookie = request.headers.get('Cookie') || '';
		token = cookie.match(/session=([^;]+)/)?.[1];
	}

	if (!token) {
		return new Response(JSON.stringify({ message: 'Unauthorized: Missing authentication token' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Cache OIDC discovery config
		if (!cachedOidc) {
			cachedOidc = await fetch(env.OIDC_DISCOVERY_URL).then(res => res.json());
		}

		// Cache JWKS for 10 minutes
		const now = Date.now();
		if (!cachedJwks || (now - lastJwksFetch > 10 * 60 * 1000)) {
			cachedJwks = await fetch(cachedOidc.jwks_uri).then(res => res.json());
			lastJwksFetch = now;
		}

		const header = decodeProtectedHeader(token);
		const key = cachedJwks.keys.find((k: any) => k?.kid === header.kid);
		if (!key) throw new Error('Invalid signing key');

		const publicKey = await importJWK(key, key.alg || 'RS256');
		const { payload } = await jwtVerify(token, publicKey, {
			issuer: cachedOidc.issuer,
			audience: env.OIDC_CLIENT_ID
		});

		const user:any = {
			id: payload.sub,
			email: payload.email,
			permissions: payload.permissions ?? [""]
		};

		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;
		const match = matchRoute(path);
		if (!match) {
			return new Response(JSON.stringify({ message: 'Not Found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const { pattern } = match;
		const routeConfig = routeMap[pattern][method];
		if (!routeConfig) {
			return new Response(JSON.stringify({ message: 'Method Not Allowed' }), {
				status: 405,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const { requiredPermission } = routeConfig;
		const orgId = params?.orgId ?? '';
		if (!hasPermission(user.permissions.join(','), orgId, requiredPermission)) {
			return new Response(JSON.stringify({
				message: 'Forbidden: Insufficient permissions to access this resource'
			}), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const enhancedRequest = new Request(request);
		enhancedRequest.headers.set('X-User-ID', user.id);
		enhancedRequest.headers.set('X-User-Email', user.email);
		if (user.permissions) {
			enhancedRequest.headers.set('X-User-Permissions', user.permissions.join(','));
		}

		return next(enhancedRequest);
	} catch (err: any) {
		logger.error('JWT validation error', { error: err.message });
		return new Response(JSON.stringify({ message: 'Unauthorized: Invalid authentication token' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export const authCallbackHandler = async (
	request: Request,
	env: Env,
	logger: Logger
): Promise<Response> => {
	try {
		const url = new URL(request.url)
		const code = url.searchParams.get('code')
		const redirectUri = `${url.origin}/auth/callback`

		if (!code) {
			return new Response('Missing code parameter', { status: 400 })
		}

		// 1. Fetch OIDC config
		const oidcRes = await fetch(env.OIDC_DISCOVERY_URL)
		if (!oidcRes.ok) throw new Error('Failed to load OIDC config')
		const oidc: any = await oidcRes.json()

		// 2. Exchange code for tokens
		const tokenRes = await fetch(oidc.token_endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: env.OIDC_CLIENT_ID,
				redirect_uri: redirectUri
			})
		})

		if (!tokenRes.ok) {
			const errText = await tokenRes.text()
			logger.error('Token exchange failed', { status: tokenRes.status, body: errText })
			return new Response('Token exchange failed ', { status: 401 })
		}

		const tokens: any = await tokenRes.json()
		const idToken = tokens.id_token
// 3. Decode the token header to extract `kid`
		const [headerB64] = idToken.split('.')
		const headerRaw = atob(headerB64)
		const header = JSON.parse(headerRaw)
		const kid = header.kid


		// 4. Fetch the JWKS
		const jwksRes = await fetch(oidc.jwks_uri)
		if (!jwksRes.ok) throw new Error('Failed to fetch JWKS')
		const jwks:any = await jwksRes.json()

		const jwk = jwks.keys.find((k: any) => k.kid === kid)
		if (!jwk) throw new Error(`No matching JWK for kid: ${kid}`)

		const publicKey = await importJWK(jwk, jwk.alg || 'RS256')

		// 5. Verify the token
		const { payload } = await jwtVerify(idToken, publicKey, {
			issuer: oidc.issuer,
			audience: env.OIDC_CLIENT_ID
		})

		const userId = payload.sub
		const email = payload.email
		if (!userId || !email) {
			return new Response('Invalid token payload', { status: 400 })
		}

		// 6. Set session cookie
		const sessionCookie = `session=${idToken}; HttpOnly; Path=/; Secure; SameSite=Lax`
		logger.info('Authenticated user', { userId, email })

		// 7. Redirect to home
		return new Response(null, {
			status: 302,
			headers: {
				'Location': `/`,
				'Set-Cookie': sessionCookie
			}
		})
	} catch (err: any) {
		logger.error('OIDC callback error', { error: err.message })
		return new Response('Authentication failed', { status: 500 })
	}
}
