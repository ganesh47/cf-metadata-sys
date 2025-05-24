import {Logger} from "./logger/logger";
import {Env, TraceContext} from "./types/graph";
import {initializeDatabase} from "./d1/initDb";
import {
	queryGraph,
	traverseGraph
} from "./graph/traversals";
import {exportMetadata, importMetadata} from "./graph/ops";
import {createNode, deleteNode, getNode, getNodes, updateNode} from "./graph/node";
import {createEdge, getEdges} from "./graph/edge";
import type {ExecutionContext} from '@cloudflare/workers-types';
import {jwtVerify} from 'jose';

// Define route handler interface with updated context
type RouteHandler = (
	request: Request,
	env: Env,
	logger: Logger,
	params?: Record<string, string>
) => Promise<Response>;

// Define a middleware type with optional params
type Middleware = (
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>,
	params?: Record<string, string>
) => Promise<Response>;

// JWT validation using jose library with JWT_SECRET
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

export function hasPermission(permissions: string, orgId: string, requiredLevel: string): boolean {
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
}

function hasRequiredLevel(userLevel: string, requiredLevel: string): boolean {
  console.log(userLevel, requiredLevel);
  if (userLevel === '*') return true;

  const levels = ['read', 'write', 'audit'];
  const userLevelIndex = levels.indexOf(userLevel);
  const requiredLevelIndex = levels.indexOf(requiredLevel);
  if (userLevelIndex === -1 || requiredLevelIndex === -1) return false;
  return userLevelIndex >= requiredLevelIndex;
}

export async function authenticate(
  request: Request,
  env: Env,
  logger: Logger,
  next: (request: Request) => Promise<Response>,
  params?: Record<string, string>
): Promise<Response> {
  // Get the JWT token from the Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ message: 'Unauthorized: Missing authentication token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.split(' ')[1];
  const result = await validateJwt(token, env, logger);

  if (!result.valid || !result.user) {
    return new Response(JSON.stringify({ message: 'Unauthorized: Invalid authentication token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get required permission for this route and method
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
  const orgId = params?.orgId || '';

  // Check if user has the required permission for this organization
  if (!hasPermission(result.user.permissions || '', orgId, requiredPermission)) {
    return new Response(JSON.stringify({
      message: 'Forbidden: Insufficient permissions to access this resource'
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
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

// Create a route map to match paths and methods to handlers
const routeMap: Record<string, Record<string, { handler: RouteHandler, requiredPermission: string }>> = {
	'/:orgId/nodes': {
		'POST': { handler: createNode, requiredPermission: 'write' },
		'GET': { handler: getNodes, requiredPermission: 'read' }
	},
	'/:orgId/nodes/:id': {
		'GET': {
			handler: async (request, env, logger, params) => getNode(params?.id || '', env, logger),
			requiredPermission: 'read'
		},
		'PUT': {
			handler: async (request, env, logger, params) => updateNode(params?.id || '', request, env, logger),
			requiredPermission: 'write'
		},
		'DELETE': {
			handler: async (request, env, logger, params) => deleteNode(params?.id || '', env, logger),
			requiredPermission: 'write'
		}
	},
	'/:orgId/edges': {
		'POST': { handler: createEdge, requiredPermission: 'write' },
		'GET': { handler: getEdges, requiredPermission: 'read' }
	},
	'/:orgId/query': {
		'POST': { handler: queryGraph, requiredPermission: 'read' }
	},
	'/:orgId/traverse': {
		'POST': { handler: traverseGraph, requiredPermission: 'read' }
	},
	'/:orgId/metadata/export': {
		'GET': {
			handler: async (request, env, logger) => exportMetadata(env, logger),
			requiredPermission: 'read'
		}
	},
	'/:orgId/metadata/import': {
		'POST': { handler: importMetadata, requiredPermission: 'write' }
	}
};

// Public routes that don't require authentication
const publicRoutes: string[] = [
	// Add any routes that should be public
	// Example: '/health', '/api/docs', etc.
];

// Match a path to a route pattern and extract parameters
export const matchRoute = (path: string): { pattern: string; params: Record<string, string> } | null => {
	// Direct match
	if (routeMap[path]) {
		return {pattern: path, params: {}};
	}

	// Match patterns with parameters
	for (const pattern of Object.keys(routeMap)) {
		// Match path pattern with orgId
		if (pattern.includes(':orgId') && path.startsWith('/')) {
			const parts = path.split('/');
			if (parts.length >= 2) {
				// The first part after the initial slash is the orgId
				const orgId = parts[1];

				// Handle node ID if present (for '/:orgId/nodes/:id')
				if (pattern.includes(':id') && path.includes('/nodes/') && parts.length >= 4) {
					const nodeId = parts[3];
					const patternParts = pattern.split('/');
					const pathParts = path.split('/');

					// Compare all parts except the parameter parts
					let matches = true;
					for (let i = 0; i < patternParts.length; i++) {
						if (patternParts[i].startsWith(':')) continue; // Skip parameter parts
						if (i >= pathParts.length || patternParts[i] !== pathParts[i]) {
							matches = false;
							break;
						}
					}

					if (matches && patternParts.length === pathParts.length) {
						return {pattern, params: {orgId, id: nodeId}};
					}
				}
				// Handle other routes with org ID only
				else {
					const patternParts = pattern.split('/');
					const pathParts = path.split('/');

					// Compare all parts except the parameter parts
					let matches = true;
					for (let i = 0; i < patternParts.length; i++) {
						if (patternParts[i].startsWith(':')) continue; // Skip parameter parts
						if (i >= pathParts.length || patternParts[i] !== pathParts[i]) {
							matches = false;
							break;
						}
					}

					if (matches && patternParts.length === pathParts.length) {
						return {pattern, params: {orgId}};
					}
				}
			}
		}
	}

	return null;
};

// Apply middleware and then call the handler
const applyMiddleware = async (
	middleware: Middleware,
	handler: RouteHandler,
	request: Request,
	env: Env,
	logger: Logger,
	params?: Record<string, string>
): Promise<Response> => {
	const next = async (req: Request) => handler(req, env, logger, params);
	return await middleware(request, env, logger, next, params);
};
// Handle the request based on the route map
const handleRequest = async (path: string, method: string, request: Request, env: Env, logger: Logger): Promise<Response | undefined> => {
	const match = matchRoute(path);
	if (match) {
		const {pattern, params} = match;
		const handlers = routeMap[pattern];
		if (handlers[method]) {
			// Check if route is public or requires authentication
			if (publicRoutes?.includes(path)) {
				return await handlers[method].handler(request, env, logger, params);
			} else {
				// Apply authentication middleware to protected routes with params
				return await applyMiddleware(
					(req, env, logger, next, params) => authenticate(req, env, logger, next, params),
					handlers[method].handler,
					request,
					env,
					logger,
					params
				);
			}
		}
	}

	return undefined;
};
// noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
export default {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const requestId = crypto.randomUUID();
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;
		const operation = `${method} ${path}`;
		const LOG_LEVEL = env.LOG_LEVEL || 'info';

		const traceContext: TraceContext = {
			requestId,
			operation,
			startTime: Date.now(),
			metadata: {
				path,
				method,
				userAgent: request.headers.get('User-Agent'),
				contentType: request.headers.get('Content-Type')
			}
		};

		const logger = new Logger(traceContext, LOG_LEVEL);

		logger.info('Request started', {
			url: url.toString(),
			headers: Object.fromEntries(request.headers.entries())
		});

		try {
			// Initialize database tables if they don't exist
			const initStart = Date.now();
			if (env.INIT_DB?.toLowerCase() === 'true') {
				await initializeDatabase(env.GRAPH_DB, logger);
				logger.performance('database_init', Date.now() - initStart);
			}
			// Use the new routing system with authentication
			const response = await handleRequest(path, method, request, env, logger);
			if (response) return response;

			// If no route matched, continue to the existing 404 handler
			logger.warn('Route not found', {path, method});
			return new Response('Not Found', {status: 404});
		} catch (error: any) {
			logger.error('Request failed', error);
			return new Response(JSON.stringify({
				error: error.message,
				requestId
			}), {
				status: 500,
				headers: {'Content-Type': 'application/json'}
			});
		} finally {
			logger.info('Request completed', {
				total_duration_ms: Date.now() - traceContext.startTime
			});
		}
	}
};
