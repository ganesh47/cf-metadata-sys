import {Logger} from "./logger/logger";
import {Env, OrgParams, TraceContext} from "./types/graph";
import {initializeDatabase} from "./d1/initDb";
import type {ExecutionContext} from '@cloudflare/workers-types';
import {matchRoute, publicRoutes, routeMap} from "./routes";
import {authenticate} from "./auth";
import {applyMiddleware} from "./middleware";

// Handle the request based on the route map
const handleRequest = async (path: string, method: string, request: Request, env: Env, logger: Logger): Promise<Response | undefined> => {
	const match = matchRoute(path);
	if (match) {
		const {pattern, params} = match;
		const handlers = routeMap[pattern];
		if (handlers[method]) {
			// Check if the route is public or requires authentication
			if (publicRoutes?.includes(path)) {
				return await handlers[method].handler(request, env, logger, params as OrgParams);
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
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
