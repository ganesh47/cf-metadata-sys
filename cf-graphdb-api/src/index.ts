import {Logger} from "./logger/logger";
import {Env, TraceContext} from "./types/graph";
import {initializeDatabase} from "./d1/initDb";
import {
	createEdge,
	createNode,
	deleteNode,
	getEdges,
	getNode,
	getNodes,
	queryGraph,
	traverseGraph,
	updateNode
} from "./graph/crud";
import {exportMetadata, importMetadata} from "./graph/ops";


// noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
export default {
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

		const logger = new Logger(traceContext,LOG_LEVEL);

		logger.info('Request started', {
			url: url.toString(),
			headers: Object.fromEntries(request.headers.entries())
		});

		try {
			// Initialize database tables if they don't exist
			const initStart = Date.now();
			await initializeDatabase(env.GRAPH_DB, logger);
			logger.performance('database_init', Date.now() - initStart);

			// Route handling with tracing
			if (path === '/nodes' && method === 'POST') {
				return await createNode(request, env, logger);
			} else if (path === '/nodes' && method === 'GET') {
				return await getNodes(request, env, logger);
			} else if (path.startsWith('/nodes/') && method === 'GET') {
				const nodeId = path.split('/')[2];
				return await getNode(nodeId, env, logger);
			} else if (path.startsWith('/nodes/') && method === 'PUT') {
				const nodeId = path.split('/')[2];
				return await updateNode(nodeId, request, env, logger);
			} else if (path.startsWith('/nodes/') && method === 'DELETE') {
				const nodeId = path.split('/')[2];
				return await deleteNode(nodeId, env, logger);
			} else if (path === '/edges' && method === 'POST') {
				return await createEdge(request, env, logger);
			} else if (path === '/edges' && method === 'GET') {
				return await getEdges(request, env, logger);
			} else if (path === '/query' && method === 'POST') {
				return await queryGraph(request, env, logger);
			} else if (path === '/traverse' && method === 'POST') {
				return await traverseGraph(request, env, logger);
			} else if (path === '/metadata/export' && method === 'GET') {
				return await exportMetadata(env, logger);
			} else if (path === '/metadata/import' && method === 'POST') {
				return await importMetadata(request, env, logger);
			}

			logger.warn('Route not found', { path, method });
			return new Response('Not Found', { status: 404 });
		} catch (error:any) {
			logger.error('Request failed', error);
			return new Response(JSON.stringify({
				error: error.message,
				requestId
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		} finally {
			logger.info('Request completed', {
				total_duration_ms: Date.now() - traceContext.startTime
			});
		}
	}
};


