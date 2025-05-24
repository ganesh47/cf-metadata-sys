import GraphNode, {Env, OrgParams} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";

export async function getNode(nodeId: string, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Retrieving node', {orgId, nodeId});

	try {
		// Try KV first for fast access
		const kvStart = Date.now();
		let nodeData = await env.GRAPH_KV.get(`node:${orgId}:${nodeId}`);
		logger.performance('kv_lookup', Date.now() - kvStart, {hit: !!nodeData});

		if (!nodeData) {
			logger.debug('Node not found in KV, checking D1', {orgId, nodeId});

			// Fallback to D1
			const d1Start = Date.now();
			const result = await env.GRAPH_DB.prepare(`
				SELECT *
				FROM ${NODES_TABLE}
				WHERE id = ? AND org_id = ?
			`).bind(nodeId, orgId).first();
			logger.performance('d1_lookup', Date.now() - d1Start, {found: !!result});

			if (!result) {
				logger.warn('Node not found', {orgId, nodeId});
				return new Response('Node not found', {status: 404});
			}

			const node: GraphNode = {
				id: result.id as string,
				org_id: result.org_id as string,
				type: result.type as string,
				properties: JSON.parse(result.properties as string),
				created_at: result.created_at as string,
				updated_at: result.updated_at as string,
				created_by: result.created_by as string,
				updated_by: result.updated_by as string,
				user_agent: result.user_agent as string,
				client_ip: result.client_ip as string
			};

			// Cache in KV for future requests
			const cacheStart = Date.now();
			await env.GRAPH_KV.put(`node:${orgId}:${nodeId}`, JSON.stringify(node));
			logger.performance('kv_cache_backfill', Date.now() - cacheStart);
			nodeData = JSON.stringify(node);
			logger.debug('Node retrieved from D1 and cached', {orgId, nodeId});
			return new Response(nodeData, {
				headers: {'Content-Type': 'application/json', 'X-Node-Cache': 'MISS'}
			})
		} else {
			logger.debug('Node retrieved from KV cache', {orgId, nodeId});
		}

		logger.info('Node retrieved successfully', {orgId, nodeId});

		return new Response(nodeData, {
			headers: {'Content-Type': 'application/json', 'X-Node-Cache': 'HIT'}
		});
	} catch (error) {
		logger.error('Failed to retrieve node', {orgId, nodeId});
		throw error;
	}
}

export async function createNode(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Creating new node', {orgId});

	try {
		// Extract user info from the request headers (set by auth middleware)
		const userId = request.headers.get('X-User-ID') || 'unknown';
		const userAgent = request.headers.get('User-Agent') || 'unknown';
		const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphNode>;
		logger.performance('parse_request_body', Date.now() - parseStart);

		const nodeId = body.id ?? crypto.randomUUID();
		const timestamp = new Date().toISOString();

		const node: GraphNode = {
			id: nodeId,
			org_id: orgId,
			type: body.type ?? 'default',
			properties: body.properties ?? {},
			created_at: timestamp,
			updated_at: timestamp,
			created_by: userId,
			updated_by: userId,
			user_agent: userAgent,
			client_ip: clientIp
		};

		logger.debug('Node data prepared', {orgId, nodeId, type: node.type});

		// Store in D1 for relational queries
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			INSERT INTO ${NODES_TABLE} (
				id, org_id, type, properties, created_at, updated_at,
				created_by, updated_by, user_agent, client_ip
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			node.id,
			node.org_id,
			node.type,
			JSON.stringify(node.properties),
			node.created_at,
			node.updated_at,
			node.created_by,
			node.updated_by,
			node.user_agent,
			node.client_ip
		).run();
		logger.performance('d1_insert', Date.now() - d1Start);

		// Cache in KV for fast access
		const kvStart = Date.now();
		await env.GRAPH_KV.put(`node:${orgId}:${nodeId}`, JSON.stringify(node));
		logger.performance('kv_cache_node', Date.now() - kvStart);

		// Store node type mapping for efficient queries
		const typeStart = Date.now();
		const typeKey = `type:${orgId}:${node.type}`;
		const existingNodes = await env.GRAPH_KV.get(typeKey);
		const nodeIds = existingNodes ? JSON.parse(existingNodes) : [];
		nodeIds.push(nodeId);
		await env.GRAPH_KV.put(typeKey, JSON.stringify(nodeIds));
		logger.performance('kv_update_type_mapping', Date.now() - typeStart);

		logger.info('Node created successfully', {orgId, nodeId, type: node.type, createdBy: userId});

		return new Response(JSON.stringify(node), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to create node', {orgId});
		throw error;
	}
}

export async function getNodes(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Getting nodes list', {orgId});

	try {
		const url = new URL(request.url);
		const nodeType = url.searchParams.get('type');
		const createdBy = url.searchParams.get('created_by');
		const updatedBy = url.searchParams.get('updated_by');
		const limit = parseInt(url.searchParams.get('limit') ?? '100');

		let query = `SELECT *
					 FROM ${NODES_TABLE}
					 WHERE org_id = ?`;
		const params: any[] = [orgId];

		if (nodeType) {
			query += ` AND type = ?`;
			params.push(nodeType);
		}

		if (createdBy) {
			query += ` AND created_by = ?`;
			params.push(createdBy);
		}

		if (updatedBy) {
			query += ` AND updated_by = ?`;
			params.push(updatedBy);
		}

		query += ` LIMIT ?`;
		params.push(limit);

		logger.debug('Executing nodes query', {orgId, nodeType, createdBy, updatedBy, limit});

		const queryStart = Date.now();
		const results = await env.GRAPH_DB.prepare(query).bind(...params).all();
		logger.performance('d1_nodes_query', Date.now() - queryStart, {
			resultCount: results.results?.length ?? 0
		});

		const nodes = results.results?.map((row: any) => ({
			id: row.id,
			org_id: row.org_id,
			type: row.type,
			properties: JSON.parse(row.properties),
			created_at: row.created_at,
			updated_at: row.updated_at,
			created_by: row.created_by,
			updated_by: row.updated_by,
			user_agent: row.user_agent,
			client_ip: row.client_ip
		})) ?? [];

		logger.info('Nodes retrieved successfully', {orgId, count: nodes.length});

		return new Response(JSON.stringify(nodes), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to get nodes', {orgId});
		throw error;
	}
}

export async function updateNode(nodeId: string, request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Updating node', {orgId, nodeId});

	try {
		// Extract user info for audit trail
		const userId = request.headers.get('X-User-ID') || 'unknown';
		const userAgent = request.headers.get('User-Agent') || 'unknown';
		const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphNode>;
		logger.performance('parse_update_body', Date.now() - parseStart);

		const timestamp = new Date().toISOString();

		// Get existing node
		const existingStart = Date.now();
		const existing = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(nodeId, orgId).first();
		logger.performance('get_existing_node', Date.now() - existingStart);

		if (!existing) {
			logger.warn('Node not found for update', {orgId, nodeId});
			return new Response('Node not found', {status: 404});
		}

		const updatedNode: GraphNode = {
			id: nodeId,
			org_id: orgId,
			type: body.type ?? existing.type as string,
			properties: {...JSON.parse(existing.properties as string), ...body.properties},
			created_at: existing.created_at as string,
			updated_at: timestamp,
			created_by: existing.created_by as string,
			updated_by: userId,
			user_agent: userAgent,
			client_ip: clientIp
		};

		logger.debug('Node update prepared', {orgId, nodeId, updatedBy: userId, changes: body});

		// Update in D1
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			UPDATE ${NODES_TABLE}
			SET type       = ?,
				properties = ?,
				updated_at = ?,
				updated_by = ?,
				user_agent = ?,
				client_ip  = ?
			WHERE id = ? AND org_id = ?
		`).bind(
			updatedNode.type,
			JSON.stringify(updatedNode.properties),
			updatedNode.updated_at,
			updatedNode.updated_by,
			updatedNode.user_agent,
			updatedNode.client_ip,
			nodeId,
			orgId
		).run();
		logger.performance('d1_update', Date.now() - d1Start);

		// Update cache in KV
		const kvStart = Date.now();
		await env.GRAPH_KV.put(`node:${orgId}:${nodeId}`, JSON.stringify(updatedNode));
		logger.performance('kv_update_cache', Date.now() - kvStart);

		// Update type mapping if the type changed
		if (body.type && body.type !== existing.type) {
			const typeMappingStart = Date.now();

			// Remove from old type mapping
			const oldTypeKey = `type:${orgId}:${existing.type}`;
			const oldNodes = await env.GRAPH_KV.get(oldTypeKey);
			if (oldNodes) {
				const oldNodeIds = JSON.parse(oldNodes).filter((id: string) => id !== nodeId);
				await env.GRAPH_KV.put(oldTypeKey, JSON.stringify(oldNodeIds));
			}

			// Add to new type mapping
			const newTypeKey = `type:${orgId}:${body.type}`;
			const newNodes = await env.GRAPH_KV.get(newTypeKey);
			const newNodeIds = newNodes ? JSON.parse(newNodes) : [];
			if (!newNodeIds.includes(nodeId)) {
				newNodeIds.push(nodeId);
				await env.GRAPH_KV.put(newTypeKey, JSON.stringify(newNodeIds));
			}

			logger.performance('update_type_mapping', Date.now() - typeMappingStart);
		}

		logger.info('Node updated successfully', {orgId, nodeId, type: updatedNode.type, updatedBy: userId});

		return new Response(JSON.stringify(updatedNode), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to update node', {orgId, nodeId});
		throw error;
	}
}

export async function deleteNode(nodeId: string, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Deleting node', {orgId, nodeId});

	try {
		// Get node details before deletion for cleanup
		const nodeStart = Date.now();
		const existingNode = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(nodeId, orgId).first();
		logger.performance('get_node_for_deletion', Date.now() - nodeStart);

		if (!existingNode) {
			logger.warn('Node not found for deletion', {orgId, nodeId});
			return new Response('Node not found', {status: 404});
		}

		// Delete all edges connected to this node
		const edgesStart = Date.now();
		const connectedEdges = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${EDGES_TABLE}
			WHERE (from_node = ? OR to_node = ?) AND org_id = ?
		`).bind(nodeId, nodeId, orgId).all();

		await env.GRAPH_DB.prepare(`
			DELETE
			FROM ${EDGES_TABLE}
			WHERE (from_node = ? OR to_node = ?) AND org_id = ?
		`).bind(nodeId, nodeId, orgId).run();
		logger.performance('delete_connected_edges', Date.now() - edgesStart, {
			edgeCount: connectedEdges.results?.length ?? 0
		});

		// Delete the node
		const nodeDeleteStart = Date.now();
		await env.GRAPH_DB.prepare(`
			DELETE
			FROM ${NODES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(nodeId, orgId).run();
		logger.performance('delete_node', Date.now() - nodeDeleteStart);

		// Clean up KV cache
		const kvCleanupStart = Date.now();
		await Promise.all([
			env.GRAPH_KV.delete(`node:${orgId}:${nodeId}`),
			env.GRAPH_KV.delete(`adj:out:${orgId}:${nodeId}`),
			env.GRAPH_KV.delete(`adj:in:${orgId}:${nodeId}`)
		]);

		// Clean up edge caches
		if (connectedEdges.results) {
			for (const edge of connectedEdges.results) {
				await env.GRAPH_KV.delete(`edge:${orgId}:${edge.id}`);
			}
		}

		// Remove from type mapping
		const nodeType = existingNode.type as string;
		const typeKey = `type:${orgId}:${nodeType}`;
		const existingNodes = await env.GRAPH_KV.get(typeKey);
		if (existingNodes) {
			const nodeIds = JSON.parse(existingNodes).filter((id: string) => id !== nodeId);
			await env.GRAPH_KV.put(typeKey, JSON.stringify(nodeIds));
		}

		logger.performance('kv_cleanup', Date.now() - kvCleanupStart);

		const result = {
			deleted: nodeId,
			org_id: orgId,
			deleted_edges: connectedEdges.results?.length ?? 0,
			timestamp: new Date().toISOString()
		};

		logger.info('Node deleted successfully', {orgId, nodeId, edgesRemoved: connectedEdges.results?.length ?? 0});

		return new Response(JSON.stringify(result), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to delete node', {orgId, nodeId});
		throw error;
	}
}
