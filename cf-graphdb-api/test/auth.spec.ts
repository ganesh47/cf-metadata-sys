// Modify your index.spec.ts to add these imports and hooks
import {afterAll, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData} from './setup';
import {DB_VERSION, EDGES_TABLE, generateTimestampVersion, NODES_TABLE} from "../src/constants";
import {initializeDatabase} from "../src/d1/initDb";
import {Env, TraceContext} from "../src/types/graph";
import {Logger} from "../src/logger/logger";
import {SignJWT} from 'jose';
import {TextEncoder} from 'util';

export async function createJwt(eenv:Env) {
	const secret = eenv.JWT_SECRET;
	expect(secret).toBeDefined();

	// Create the secret key from the JWT_SECRET
	const secretKey = new TextEncoder().encode(secret);

	// Create a payload with user data
	const payload = {
		id: "1234",
		email: "test@example.com"
	};

	// Sign a new JWT with the secret and payload
	return await new SignJWT(payload)
		.setProtectedHeader({alg: 'HS256'})
		.setSubject(payload.id)          // Set subject to user ID
		.setIssuedAt()                   // Set issued at time to now
		.setExpirationTime('1h')         // Token expires in 1 hour
		.sign(secretKey);
}

describe('Auth GraphDB Worker Tests', () => {
	afterAll(async () => {
		await cleanAllData();
		console.log('✓ Final database cleanup completed');
	});
	describe('Authentication', () => {
		it('should return 401 when no authentication token is provided', async () => {
			// Try to access a protected route without a token
			const response = await SELF.fetch('http://localhost/nodes', {
				method: 'GET',
				headers: {'Content-Type': 'application/json'}
				// No Authorization header
			});

			// Verify the response is an Unauthorized error
			expect(response.status).toBe(401);
			const responseMsg = await response.json();
			expect(responseMsg.message).toContain('Unauthorized: Missing authentication token');
		});

		it('should return 401 when an invalid authentication token is provided', async () => {
			// Try to access a protected route with an invalid token
			const response = await SELF.fetch('http://localhost/nodes', {
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
			const response = await SELF.fetch('http://localhost/nodes', {
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

	// Your existing test suites...

});
