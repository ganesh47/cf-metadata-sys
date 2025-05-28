// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, fetchValidAuthCode, prepareLogger} from './setup';
import {DB_VERSION, EDGES_TABLE, generateTimestampVersion, NODES_TABLE} from "../src/constants";
import {initializeDatabase} from "../src/d1/initDb";
import {Env, TraceContext} from "../src/types/graph";
import {Logger} from "../src/logger/logger";
import {decodeJwt, decodeProtectedHeader, importJWK, jwtVerify} from 'jose';

let cachedToken: { token: string; exp: number } | null = null

export async function createJwt(env: Env): Promise<string> {
	const now = Math.floor(Date.now() / 1000)
	if (cachedToken && cachedToken.exp > now + 300) {
		// Return cached token if it's still valid for at least 60 seconds
		return cachedToken.token
	}

	const { id_token }: any = await fetchValidAuthCode(env)

	// Decode expiry from token
	const { exp }:any = decodeJwt(id_token)

	cachedToken = {
		token: id_token,
		exp
	}

	return id_token
}

describe('Auth GraphDB Worker Tests', () => {
	const eenv = env as Env
	const {initStart, logger} = prepareLogger();
	beforeAll(async () => {
		await initializeDatabase(eenv.GRAPH_DB, logger);
		logger.performance('database_init', Date.now() - initStart);
	})

	afterAll(async () => {
		await cleanAllData();
		console.log('✓ Final database cleanup completed');
	});
	describe('Authentication', () => {
		it('should return 401 when no authentication token is provided', async () => {
			// Try to access a protected route without a token
			const response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'GET',
				headers: {'Content-Type': 'application/json'}
				// No Authorization header
			});

			// Verify the response is an Unauthorized error
			expect(response.status).toBe(401);
			const responseMsg: any = await response.json();
			expect(responseMsg.message).toContain('Unauthorized: Missing authentication token');
		});
		it('should return 404 for an non-existing route', async () => {
			// Try to access a protected route without a token
			const response = await SELF.fetch('http://localhost/test/zydf', {
				method: 'GET',
				headers: {'Content-Type': 'application/json'}
				// No Authorization header
			});

			// Verify the response is an Unauthorized error
			expect(response.status).toBe(404);
		});

		it('should return 401 when an invalid authentication token is provided', async () => {
			// Try to access a protected route with an invalid token
			const response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer invalid-token-value'
				}
			});

			// Verify the response is an Unauthorized error
			expect(response.status).toBe(401);
			const responseText = await response.text();
			expect(responseText).toContain('Unauthorized: Invalid authentication token');
		});

		it('should allow access when a valid authentication token is provided', async () => {
			// Cast env to access test properties
			const eenv = env as any;

			// Get the JWT_SECRET from environment
			const validToken = await createJwt(eenv);

			// Try to access a protected route with the valid token
			const response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			// Verify the response is successful
			expect(response.status).toBe(200);
		});
	});
	describe('Database version', () => {
		it('should use the correct database version', () => {
			// Check that DB_VERSION is used for table names
			expect(NODES_TABLE).toEqual(`nodes_${DB_VERSION}`);
			expect(EDGES_TABLE).toEqual(`edges_${DB_VERSION}`);
		});
		it('versioing gen works correctly with ts', () => {
			expect(generateTimestampVersion()).toMatch(/^v\d{10}$/);
		})
	})

	describe(" Database init should throw error when not configured currently", () => {
		it("should throw error when not configured", async () => {
			const traceContext: TraceContext = {
				requestId: '',
				operation: '',
				startTime: Date.now(),
				metadata: {
					path: '',
					method: '',
					userAgent: '007',
					contentType: ''
				}
			};

			const logger = new Logger(traceContext, "info");
			await expect(() => initializeDatabase(undefined as any, logger)).rejects.toThrow(Error);
		});
	})


	describe('/auth/callback integration tests', () => {
		it('should return 400 when no code is present', async () => {
			const response = await SELF.fetch(`http://localhost/auth/callback`)
			expect(response.status).toBe(400)
			const text = await response.text()
			expect(text).toContain('Missing code')
		})

		it('should return 401 for invalid code', async () => {
			const response = await SELF.fetch(`http://localhost/auth/callback?code=invalid`)
			expect(response.status).toBe(401)
			const text = await response.text()
			expect(text).toContain('Token exchange failed')
		})


		it('should handle Keycloak discovery failure gracefully', async () => {
			const brokenEnv = {
				...env,
				OIDC_DISCOVERY_URL: 'https://invalid-url/.well-known/openid-configuration'
			}

			const response = await SELF.fetch(`http://localhost/auth/callback?code=somecode`, {
				headers: {
					'X-Mock-Env': JSON.stringify(brokenEnv)
				}
			})

			expect(response.status).toBe(401)
			const text = await response.text()
			expect(text).toContain('Token exchange failed')
		})
	})

	describe('OIDC Auth End-to-End Integration', () => {
		it('should perform full login and verify session JWT with permissions', async () => {
			// Step 1: Get ID token via ROPC flow (username + password)
			const tokens: any = await fetchValidAuthCode(eenv)
			expect(tokens.id_token).toBeTruthy()
			const sessionJwt = tokens.id_token
			// Step 2: Use the id_token as session cookie to hit a protected route
			const response = await SELF.fetch(`http://localhost:8787/test/nodes`, {
				headers: {
					Cookie: `session=${sessionJwt}`
				}
			})
			expect(response.status).toBe(200)
			expect(sessionJwt).toBeTruthy()
			// Step 3: Fetch OIDC config + JWKS
			const oidc: any = await fetch(eenv.OIDC_DISCOVERY_URL).then(res => res.json())
			const jwks: any = await fetch(oidc.jwks_uri).then(res => res.json())
			const header: any = decodeProtectedHeader(sessionJwt)
			const key = jwks.keys.find((k: any) => k?.kid === header.kid)
			expect(key).toBeTruthy()
			const publicKey = await importJWK(key, key.alg || 'RS256')
			const {payload}: any = await jwtVerify(sessionJwt, publicKey, {
				issuer: oidc.issuer,
				audience: eenv.OIDC_CLIENT_ID
			})
			// Step 4: Validate standard claims
			expect(payload).toHaveProperty('sub')
			expect(payload).toHaveProperty('email')
			expect(payload).toHaveProperty('preferred_username')
			// Step 5: Validate custom claims (e.g., permissions)
			expect(payload).toHaveProperty('permissions')
			expect(Array.isArray(payload.permissions)).toBe(true)
			expect(payload.permissions.length).toBeGreaterThan(2)
		})
	})

	// Your existing test suites...

});
