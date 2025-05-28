// JWT validation using jose library with JWT_SECRET
import {Env} from "./types/graph";
import {Logger} from "./logger/logger";
import {jwtVerify} from "jose";
import {matchRoute, routeMap} from "./routes";

export const validateJwt = async (token: string, env: Env, logger: Logger): Promise<{
	valid: boolean;
	user: { id: string, email: string, permissions?: string } | null;
	error?: string;
}> => {
	try {
		// Get the JWT_SECRET from the environment
		const secret = env.JWT_SECRET;
		if (!secret) {
			logger.error('JWT_SECRET not configured');
			return {valid: false, user: null, error: 'JWT_SECRET not configured'};
		}

		// Convert the secret to Uint8Array (required by jose)
		const secretKey = new TextEncoder().encode(secret);

		// Verify the JWT with the secret
		const {payload} = await jwtVerify(
			token,
			secretKey,
			{
				// Optional: Add additional verification if needed
				clockTolerance: 5, // 5 seconds tolerance for clock skew
			}
		);

		// Extract only the needed user information
		const user = {
			id: payload.sub ?? '',
			email: payload.email as string ?? '',
			permissions: payload.permissions as string ?? ''
		};

		// Validate that required fields exist
		if (!user.id || !user.email) {
			logger.warn('JWT missing required user fields', {
				hasId: !!user.id,
				hasEmail: !!user.email
			});
			return {
				valid: false,
				user: null,
				error: 'JWT payload missing required user fields'
			};
		}

		logger.debug('JWT verified successfully', {userId: user.id});
		return {valid: true, user};

	} catch (error: any) {
		logger.error('JWT verification failed', {error: error.message});
		return {
			valid: false,
			user: null,
			error: error.message
		};
	}
};
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

export async function authenticate(
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>,
	params?: Record<string, string>
): Promise<Response> {
	// Get the JWT token from the Authorization header
	const authHeader = request.headers.get('Authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return new Response(JSON.stringify({message: 'Unauthorized: Missing authentication token'}), {
			status: 401,
			headers: {'Content-Type': 'application/json'}
		});
	}

	const token = authHeader.split(' ')[1];
	const result = await validateJwt(token, env, logger);

	if (!result.valid || !result.user) {
		return new Response(JSON.stringify({message: 'Unauthorized: Invalid authentication token'}), {
			status: 401,
			headers: {'Content-Type': 'application/json'}
		});
	}

	// Get required permission for this route and method
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	const match = matchRoute(path);
	if (!match) {
		return new Response(JSON.stringify({message: 'Not Found'}), {
			status: 404,
			headers: {'Content-Type': 'application/json'}
		});
	}

	const {pattern} = match;
	const routeConfig = routeMap[pattern][method];

	if (!routeConfig) {
		return new Response(JSON.stringify({message: 'Method Not Allowed'}), {
			status: 405,
			headers: {'Content-Type': 'application/json'}
		});
	}

	const {requiredPermission} = routeConfig;
	const orgId = params?.orgId ?? '';

	// Check if a user has the required permission for this organization
	if (!hasPermission((result.user.permissions ?? ''), orgId, requiredPermission)) {
		return new Response(JSON.stringify({
			message: 'Forbidden: Insufficient permissions to access this resource'
		}), {
			status: 403,
			headers: {'Content-Type': 'application/json'}
		});
	}

	// Add user information to request headers
	const enhancedRequest = new Request(request);
	enhancedRequest.headers.set('X-User-ID', result.user.id);
	enhancedRequest.headers.set('X-User-Email', result.user.email);
	if (result.user.permissions) {
		enhancedRequest.headers.set('X-User-Permissions', result.user.permissions);
	}

	// Pass the authenticated request to the next handler
	return next(enhancedRequest);
}
