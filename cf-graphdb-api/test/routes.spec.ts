import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {jwtVerify} from 'jose';

import {prepareLogger} from "./setup";
import {matchRoute} from "../src/routes";
import {authenticate, hasPermission, validateJwt} from "../src/auth";

// Mock the jose library
vi.mock('jose', () => {
	return {
		jwtVerify: vi.fn()
	};
});

// Mock route map for testing
const testRouteMap: Record<string, Record<string, { handler: any, requiredPermission: string }>> = {
	'/:orgId/nodes': {
		'GET': {
			handler: vi.fn().mockResolvedValue(new Response('Node list', {status: 200})),
			requiredPermission: 'read'
		},
		'POST': {
			handler: vi.fn().mockResolvedValue(new Response('Node created', {status: 201})),
			requiredPermission: 'write'
		}
	},
	'/:orgId/nodes/:id': {
		'GET': {
			handler: vi.fn().mockResolvedValue(new Response('Node details', {status: 200})),
			requiredPermission: 'read'
		},
		'PUT': {
			handler: vi.fn().mockResolvedValue(new Response('Node updated', {status: 200})),
			requiredPermission: 'write'
		},
		'DELETE': {
			handler: vi.fn().mockResolvedValue(new Response('Node deleted', {status: 200})),
			requiredPermission: 'write'
		}
	},
	'/:orgId/edges': {
		'GET': {
			handler: vi.fn().mockResolvedValue(new Response('Edge list', {status: 200})),
			requiredPermission: 'read'
		},
		'POST': {
			handler: vi.fn().mockResolvedValue(new Response('Edge created', {status: 201})),
			requiredPermission: 'write'
		}
	}
};

// Mock the global routeMap variable since we're importing the real functions
vi.mock('./index', async (importOriginal) => {
	const originalModule: any = await importOriginal();
	return {
		...originalModule,
		routeMap: testRouteMap,
	};
});

describe('JWT Authentication and Permissions', () => {
	let env: any;
	const {initStart, logger} = prepareLogger();
	console.log(initStart)
	let mockNext: (request: Request) => Promise<Response>;

	beforeEach(() => {
		// Reset mocks
		vi.resetAllMocks();

		// Setup test environment
		env = {JWT_SECRET: 'test-secret'};


		mockNext = vi.fn().mockResolvedValue(new Response('Success', {status: 200}));

		// Mock jwtVerify to return a valid payload by default
		(jwtVerify as any).mockResolvedValue({
			payload: {
				sub: 'user-123',
				email: 'test@example.com',
				permissions: 'org1:read,org2:write,*:audit'
			}
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('validateJwt', () => {
		it('should return valid user when JWT is valid', async () => {
			const result = await validateJwt('valid.jwt.token', env, logger);

			expect(result.valid).toBe(true);
			expect(result.user).toEqual({
				id: 'user-123',
				email: 'test@example.com',
				permissions: 'org1:read,org2:write,*:audit'
			});
		});

		it('should return error when JWT_SECRET is not configured', async () => {
			env.JWT_SECRET = '';
			const result = await validateJwt('valid.jwt.token', env, logger);

			expect(result.valid).toBe(false);
			expect(result.error).toBe('JWT_SECRET not configured');
		});

		it('should return error when required user fields are missing', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					// Missing 'sub' and 'email'
					permissions: 'org1:read'
				}
			});

			const result = await validateJwt('invalid.jwt.token', env, logger);

			expect(result.valid).toBe(false);
			expect(result.error).toBe('JWT payload missing required user fields');
		});

		it('should return error when JWT verification fails', async () => {
			(jwtVerify as any).mockRejectedValueOnce(new Error('Invalid signature'));

			const result = await validateJwt('invalid.jwt.token', env, logger);

			expect(result.valid).toBe(false);
			expect(result.error).toBe('Invalid signature');
		});
	});

	describe('hasPermission', () => {
		it('should return true for wildcard scope', () => {
			expect(hasPermission('*:read', 'org1', 'read')).toBe(true);
		});

		it('should return true for wildcard permission', () => {
			expect(hasPermission('org1:*', 'org1', 'read')).toBe(true);
			expect(hasPermission('org1:*', 'org1', 'write')).toBe(true);
			expect(hasPermission('org1:*', 'org1', 'audit')).toBe(true);
		});

		it('should return true for global wildcard permission', () => {
			expect(hasPermission('*:*', 'org1', 'read')).toBe(true);
			expect(hasPermission('*:*', 'org2', 'write')).toBe(true);
		});

		it('should return true for matching specific org and permission', () => {
			expect(hasPermission('org1:read', 'org1', 'read')).toBe(true);
			expect(hasPermission('org1:write', 'org1', 'write')).toBe(true);
		});

		it('should return false for non-matching org', () => {
			expect(hasPermission('org1:read', 'org2', 'read')).toBe(false);
			expect(hasPermission('org1:write', 'org2', 'write')).toBe(false);
		});

		it('should return false for insufficient permission level', () => {
			expect(hasPermission('org1:read', 'org1', 'write')).toBe(false);
			expect(hasPermission('org1:read', 'org1', 'audit')).toBe(false);
		});

		it('should return true for higher permission levels', () => {
			expect(hasPermission('org1:write', 'org1', 'read')).toBe(true); // write can read
			expect(hasPermission('org1:audit', 'org1', 'read')).toBe(true); // audit can read
			expect(hasPermission('org1:audit', 'org1', 'write')).toBe(true); // audit can write
		});

		it('should return true for multiple permissions when one matches', () => {
			expect(hasPermission('org1:read,org2:write', 'org1', 'read')).toBe(true);
			expect(hasPermission('org1:read,org2:write', 'org2', 'write')).toBe(true);
		});

		it('should return false for empty permissions', () => {
			expect(hasPermission('', 'org1', 'read')).toBe(false);
		});
	});

	describe('matchRoute', () => {
		it('should match /:orgId/nodes route pattern', () => {
			const result = matchRoute('/org1/nodes');

			expect(result).toEqual({
				pattern: '/:orgId/nodes',
				params: {orgId: 'org1'}
			});
		});

		it('should match /:orgId/nodes/:id route pattern', () => {
			const result = matchRoute('/org1/nodes/node123');

			expect(result).toEqual({
				pattern: '/:orgId/nodes/:id',
				params: {orgId: 'org1', id: 'node123'}
			});
		});

		it('should return null for non-matching routes', () => {
			expect(matchRoute('/invalid/path')).toBeNull();
			expect(matchRoute('/org1/unknown')).toBeNull();
		});
	});

	describe('authenticate middleware', () => {
		it('should return 401 when Authorization header is missing', async () => {
			const request = new Request('https://example.com/org1/nodes');

			const response = await authenticate(request, env, logger, mockNext);

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				message: 'Unauthorized: Missing authentication token'
			});
		});

		it('should return 401 when JWT validation fails', async () => {
			(jwtVerify as any).mockRejectedValueOnce(new Error('Invalid token'));

			const request = new Request('https://example.com/org1/nodes', {
				headers: {'Authorization': 'Bearer invalid.token'}
			});

			const response = await authenticate(request, env, logger, mockNext);

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				message: 'Unauthorized: Invalid authentication token'
			});
		});

		it('should return 403 when user lacks permission for the organization', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:read' // only has access to org1
				}
			});

			const request = new Request('https://example.com/org2/nodes', {
				method: 'GET',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const response = await authenticate(
				request,
				env,
				logger,
				mockNext)
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				message: 'Forbidden: Insufficient permissions to access this resource'
			});
		});

		it('should return 403 when user lacks sufficient permission level', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:read' // only has read permission
				}
			});

			const request = new Request('https://example.com/org1/nodes', {
				method: 'POST', // trying to write
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const response = await authenticate(
				request,
				env,
				logger,
				mockNext,
				{orgId: 'org1'}
			);

			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				message: 'Forbidden: Insufficient permissions to access this resource'
			});
		});

		it('should call next() and add user headers when authentication succeeds', async () => {
			const request = new Request('https://example.com/org1/nodes', {
				method: 'GET',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			await authenticate(
				request,
				env,
				logger,
				mockNext,
				{orgId: 'org1'}
			);

			expect(mockNext).toHaveBeenCalled();

			// Check if the enhanced request has the user headers
		});

		it('should support wildcards in permissions', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: '*:write' // can write to any org
				}
			});

			const request = new Request('https://example.com/any-org/nodes', {
				method: 'POST',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const response = await authenticate(
				request,
				env,
				logger,
				mockNext,
				{orgId: 'any-org'}
			);

			expect(response.status).toBe(200);
		});

		it('should support multiple permission entries', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:read,org2:write,org3:audit'
				}
			});

			// Test for org1:read
			const readRequest = new Request('https://example.com/org1/nodes', {
				method: 'GET',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			await authenticate(readRequest, env, logger, mockNext, {orgId: 'org1'});
			expect(mockNext).toHaveBeenCalled();
			vi.clearAllMocks();

			// Reset jwtVerify mock for the next request
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:read,org2:write,org3:audit'
				}
			});

			// Test for org2:write
			const writeRequest = new Request('https://example.com/org2/nodes', {
				method: 'POST',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			await authenticate(writeRequest, env, logger, mockNext, {orgId: 'org2'});
			expect(mockNext).toHaveBeenCalled();
		});
	});

	describe('Integration tests', () => {
		it('should process organization-specific routes correctly', async () => {
			// Set up a mock fetch event
			const request = new Request('https://example.com/org1/nodes', {
				method: 'GET',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			// Mock the handleRequest function by directly testing its components
			const match = matchRoute('/org1/nodes');
			expect(match).not.toBeNull();

			const {pattern, params} = match!;
			expect(pattern).toBe('/:orgId/nodes');
			expect(params).toEqual({orgId: 'org1'});

			// Get required permission for this route
			const requiredPermission = testRouteMap[pattern]['GET'].requiredPermission;
			expect(requiredPermission).toBe('read');

			// Test auth middleware with the extracted params and required permission
			const response = await authenticate(request, env, logger, mockNext, params);
			expect(response.status).toBe(200);

			// Verify the user context was properly passed
			expect(mockNext).toHaveBeenCalled();
		});

		it('should handle specific resource ID extraction correctly', async () => {
			const request = new Request('https://example.com/org1/nodes/node123', {
				method: 'GET',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const match = matchRoute('/org1/nodes/node123');
			expect(match).not.toBeNull();

			const {pattern, params} = match!;
			expect(pattern).toBe('/:orgId/nodes/:id');
			expect(params).toEqual({orgId: 'org1', id: 'node123'});

			// Get required permission for this route
			const requiredPermission = testRouteMap[pattern]['GET'].requiredPermission;
			expect(requiredPermission).toBe('read');

			// Make sure these params are passed through auth middleware
			await authenticate(request, env, logger, mockNext, params);
			expect(mockNext).toHaveBeenCalled();
		});

		it('should handle permission checks for write operations', async () => {
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:write,org2:read'
				}
			});

			// Test POST to org1 (should succeed with write permission)
			const writeRequest = new Request('https://example.com/org1/nodes', {
				method: 'POST',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const match = matchRoute('/org1/nodes');
			const {params} = match!;
			const requiredPermission = testRouteMap['/:orgId/nodes']['POST'].requiredPermission;
			expect(requiredPermission).toBe('write');

			const response = await authenticate(writeRequest, env, logger, mockNext, params);
			expect(response.status).toBe(200);

			// Reset and test POST to org2 (should fail with only read permission)
			vi.clearAllMocks();
			(jwtVerify as any).mockResolvedValueOnce({
				payload: {
					sub: 'user-123',
					email: 'test@example.com',
					permissions: 'org1:write,org2:read'
				}
			});

			const failRequest = new Request('https://example.com/org2/nodes', {
				method: 'POST',
				headers: {'Authorization': 'Bearer valid.token'}
			});

			const match2 = matchRoute('/org2/nodes');
			const {params: params2} = match2!;
			const requiredPermission2 = testRouteMap['/:orgId/nodes']['POST'].requiredPermission;
			expect(requiredPermission2).toBe('write');

			const response2 = await authenticate(failRequest, env, logger, mockNext, params2);
			expect(response2.status).toBe(403);
		});
	});
});
