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

// Define route handler interface
type RouteHandler = (request: Request, env: Env, logger: Logger, params?: Record<string, string>) => Promise<Response>;

// Define middleware type
type Middleware = (
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>
) => Promise<Response>;

// Authentication middleware
async function authenticate(
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>
): Promise<Response> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader) {
		logger.warn('Authentication failed: Missing Authorization header');
		return new Response('Unauthorized: Missing authentication token', {status: 401});
	}

	try {
		// Extract token from Authorization header (Bearer token)
		const token = authHeader.startsWith('Bearer ')
			? authHeader.slice(7)
			: authHeader;

		// Validate token (example implementation - replace with your actual auth logic)
		const isValid = await validateToken(token, env, logger);

		if (!isValid) {
			logger.warn('Authentication failed: Invalid token', {token: token.slice(0, 10) + '...'});
			return new Response('Unauthorized: Invalid authentication token', {status: 401});
		}

		logger.debug('Authentication successful');
		return await next(request);
	} catch (error) {
		logger.error('Authentication error', error);
		return new Response('Authentication error', {status: 500});
	}
}

// Example token validation function (replace with your actual implementation)
async function validateToken(token: string, env: Env, logger: Logger): Promise<boolean> {
	// Placeholder for actual token validation logic
	// You might validate against a KV store, call an external auth service, etc.
	try {
		// Example: Check if token exists in KV store
		const storedToken = await env.AUTH_KV?.get(`token:${token}`);
		return !!storedToken;
	} catch (error) {
		logger.error('Token validation error', error);
		return false;
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

// Public routes that don't require authentication (if needed)
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

		if (handlers && handlers[method]) {
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
			await initializeDatabase(env.GRAPH_DB, logger);
			logger.performance('database_init', Date.now() - initStart);

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
