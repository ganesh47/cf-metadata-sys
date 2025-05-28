// Create a route map to match paths and methods to handlers
import {createNode, deleteNode, getNode, getNodes, updateNode} from "./graph/node";
import {Env, OrgParams} from "./types/graph";
import {createEdge, deleteEdge, getEdge, getEdges, updateEdge} from "./graph/edge";
import {queryGraph, traverseGraph} from "./graph/traversals";
import {exportMetadata, importMetadata} from "./graph/ops";
import {Logger} from "./logger/logger";

export type RouteHandler = (
	request: Request,
	env: Env,
	logger: Logger,
	params: OrgParams
) => Promise<Response>;

export const routeMap: Record<string, Record<string, { handler: RouteHandler, requiredPermission: string }>> = {
	'/:orgId/nodes': {
		'POST': {handler: createNode, requiredPermission: 'write'},
		'GET': {handler: getNodes, requiredPermission: 'read'}
	},
	'/:orgId/nodes/:id': {
		'GET': {
			handler: async (request, env, logger, params) => getNode(params?.id || '', env, logger, params),
			requiredPermission: 'read'
		},
		'PUT': {
			handler: async (request, env, logger, params) => updateNode(params?.id || '', request, env, logger, params),
			requiredPermission: 'write'
		},
		'DELETE': {
			handler: async (request, env, logger, params) => deleteNode(params?.id || '', env, logger, params),
			requiredPermission: 'write'
		}
	},
	'/:orgId/edges': {
		'GET': {handler: getEdges, requiredPermission: 'read'}
	},
	'/:orgId/edge/:id': {
		'GET': {
			handler: async (request, env, logger, params) => {
				return getEdge(params?.id || '', env, logger, params);
			}, requiredPermission: 'read'
		},
		'PUT': {
			handler: async (request, env, logger, params) => updateEdge(params?.id || '', request, env, logger, params),
			requiredPermission: 'write'
		},
		'PATCH': {
			handler: async (request, env, logger, params) => updateEdge(params?.id || '', request, env, logger, params),
			requiredPermission: 'write'
		},
		'DELETE': {
			handler: async (request, env, logger, params) => deleteEdge(params?.id || '', env, logger, params),
			requiredPermission: 'write'
		}
	},
	'/:orgId/edge': {'POST': {handler: createEdge, requiredPermission: 'write'}},
	'/:orgId/query': {'POST': {handler: queryGraph, requiredPermission: 'read'}},
	'/:orgId/traverse': {'POST': {handler: traverseGraph, requiredPermission: 'read'}},
	'/:orgId/metadata/export': {
		'GET': {
			handler: async (request, env, logger, params: OrgParams) => exportMetadata(env, logger, params),
			requiredPermission: 'read'
		}
	},
	'/:orgId/metadata/import': {
		'POST': {handler: importMetadata, requiredPermission: 'write'}
	}
};
// Match a path to a route pattern and extract parameters
export const matchRoute = (path: string): { pattern: string; params: Record<string, string> } | null => {
	// Direct match
	if (routeMap[path]) {
		return {pattern: path, params: {}};
	}

	// Match patterns with parameters
	for (const pattern of Object.keys(routeMap)) {
		if (!pattern.includes(':orgId') || !path.startsWith('/')) {
			continue;
		}

		const parts = path.split('/');
		if (parts.length < 2) {
			continue;
		}

		const orgId = parts[1];
		const patternParts = pattern.split('/');
		const pathParts = path.split('/');

		if (patternParts.length !== pathParts.length) {
			continue;
		}

		const matches = compareParts(patternParts, pathParts);
		if (!matches) {
			continue;
		}

		// Handle routes with node ID
		if (pattern.includes(':id') && parts.length >= 4) {
			const nodeId = parts[3];
			return {pattern, params: {orgId, id: nodeId}};
		}

		// Handle routes with just orgId
		return {pattern, params: {orgId}};
	}

	return null;
};

const compareParts = (patternParts: string[], pathParts: string[]): boolean => {
	for (let i = 0; i < patternParts.length; i++) {
		if (patternParts[i].startsWith(':')) {
			continue;
		}
		if (i >= pathParts.length || patternParts[i] !== pathParts[i]) {
			return false;
		}
	}
	return true;
}
// Public routes that don't require authentication
export const publicRoutes: string[] = [
	// Add any routes that should be public
	// Example: '/health', '/api/docs', etc.
];
