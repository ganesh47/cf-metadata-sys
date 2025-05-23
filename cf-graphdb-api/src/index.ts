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

// Define user context interface
interface UserContext {
	id: string;
	email: string;

	[key: string]: unknown;
}

// Extend TraceContext to include user information
interface AuthenticatedTraceContext extends TraceContext {
	user?: UserContext;
}

// Define route handler interface with updated context
type RouteHandler = (
	request: Request,
	env: Env,
	logger: Logger,
	params?: Record<string, string>
) => Promise<Response>;

// Define middleware type
type Middleware = (
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>
) => Promise<Response>;

// JWT validation using jose library with JWT_SECRET
async function validateJwt(token: string, env: Env, logger: Logger): Promise<{
	valid: boolean;
	user: { id: string, email: string } | null;
	error?: string;
}> {
	try {
		// Get the JWT_SECRET from environment
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
			email: payload.email as string ?? ''
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
}

// Authentication middleware with proper JWT validation
async function authenticate(
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>
): Promise<Response> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader) {
		logger.warn('Authentication failed: Missing Authorization header');
		return new Response(JSON.stringify({message: 'Unauthorized: Missing authentication token'}), {status: 401});
	}

	try {
		// Extract token from Authorization header (Bearer token)
		const token = authHeader.startsWith('Bearer ')
			? authHeader.slice(7)
			: authHeader;

		// Validate the JWT with proper signature verification
		const {valid, user, error} = await validateJwt(token, env, logger);


		if (!valid || !user) {
			logger.warn('Authentication failed: Invalid or expired token', {
				tokenId: token.slice(0, 10) + '...',
				error
			});
			return new Response(JSON.stringify({message: 'Unauthorized: Invalid authentication token'}), {status: 401});
		}

		// Extract user information from the validated payload
		// const user: UserContext = {
		//   id: payload.sub || '',
		//   email: payload.email || '',
		//   // Add any other claims you need
		//   roles: payload.roles || [],
		//   name: payload.name || ''
		// };

		// Update trace context with user info
		if (logger.context && typeof logger.context === 'object') {
			(logger.context as AuthenticatedTraceContext).user = user;

			// Also add user info to the metadata for logging
			logger.context.metadata = {
				...logger.context.metadata,
				userId: user.id,
				userEmail: user.email
			};
		}

		logger.debug('Authentication successful', {userId: user.id});

		// Create a new request with user context in headers
		const enhancedRequest = new Request(request);
		enhancedRequest.headers.set('X-User-ID', user.id);
		enhancedRequest.headers.set('X-User-Email', user.email);

		return await next(enhancedRequest);
	} catch (error) {
		logger.error('Authentication error', error);
		return new Response(JSON.stringify({message: 'Authentication error'}), {status: 500});
	}
}

// Create a route map to match paths and methods to handlers
const routeMap: Record<string, Record<string, RouteHandler>> = {
	'/nodes': {
		'POST': createNode,
		'GET': getNodes
	},
	'/nodes/:id': {
		'GET': async (request, env, logger, params) => getNode(params?.id || '', env, logger),
		'PUT': async (request, env, logger, params) => updateNode(params?.id || '', request, env, logger),
		'DELETE': async (request, env, logger, params) => deleteNode(params?.id || '', env, logger)
	},
	'/edges': {
		'POST': createEdge,
		'GET': getEdges
	},
	'/query': {
		'POST': queryGraph
	},
	'/traverse': {
		'POST': traverseGraph
	},
	'/metadata/export': {
		'GET': async (request, env, logger) => exportMetadata(env, logger)
	},
	'/metadata/import': {
		'POST': importMetadata
	}
};

// Public routes that don't require authentication
const publicRoutes: string[] = [
	// Add any routes that should be public
	// Example: '/health', '/api/docs', etc.
];

// Match a path to a route pattern and extract parameters
function matchRoute(path: string): { pattern: string; params: Record<string, string> } | null {
	// Direct match
	if (routeMap[path]) {
		return {pattern: path, params: {}};
	}

	// Match patterns with parameters
	for (const pattern of Object.keys(routeMap)) {
		if (pattern.includes(':id') && path.startsWith('/nodes/')) {
			const nodeId = path.split('/')[2];
			return {pattern, params: {id: nodeId}};
		}
	}

	return null;
}

// Apply middleware and then call the handler
async function applyMiddleware(
	middleware: Middleware,
	handler: RouteHandler,
	request: Request,
	env: Env,
	logger: Logger,
	params?: Record<string, string>
): Promise<Response> {
	const next = async (req: Request) => handler(req, env, logger, params);
	return await middleware(request, env, logger, next);
}

// Handle the request based on the route map
async function handleRequest(path: string, method: string, request: Request, env: Env, logger: Logger): Promise<Response | undefined> {
	const match = matchRoute(path);
	if (match) {
		const {pattern, params} = match;
		const handlers = routeMap[pattern];
		if (handlers[method]) {
			// Check if route is public or requires authentication
			if (publicRoutes?.includes(path)) {
				return await handlers[method](request, env, logger, params);
			} else {
				// Apply authentication middleware to protected routes
				return await applyMiddleware(
					authenticate,
					handlers[method],
					request,
					env,
					logger,
					params
				);
			}
		}
	}

	return undefined;
}

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
