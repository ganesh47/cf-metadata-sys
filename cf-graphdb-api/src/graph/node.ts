import GraphNode, {Env} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";

export async function getNode(nodeId: string, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Retrieving node', {nodeId});

	try {
		// Try KV first for fast access
		const kvStart = Date.now();
		let nodeData = await env.GRAPH_KV.get(`node:${nodeId}`);
		logger.performance('kv_lookup', Date.now() - kvStart, {hit: !!nodeData});

		if (!nodeData) {
			logger.debug('Node not found in KV, checking D1', {nodeId});

			// Fallback to D1
			const d1Start = Date.now();
			const result = await env.GRAPH_DB.prepare(`
				SELECT *
				FROM ${NODES_TABLE}
				WHERE id = ?
			`).bind(nodeId).first();
			logger.performance('d1_lookup', Date.now() - d1Start, {found: !!result});

			if (!result) {
				logger.warn('Node not found', {nodeId});
				return new Response('Node not found', {status: 404});
			}

			const node: GraphNode = {
				id: result.id as string,
				type: result.type as string,
				properties: JSON.parse(result.properties as string),
				created_at: result.created_at as string,
				updated_at: result.updated_at as string
			};

			// Cache in KV for future requests
			const cacheStart = Date.now();
			await env.GRAPH_KV.put(`node:${nodeId}`, JSON.stringify(node));
			logger.performance('kv_cache_backfill', Date.now() - cacheStart);
			nodeData = JSON.stringify(node);
			logger.debug('Node retrieved from D1 and cached', {nodeId});
			return new Response(nodeData, {
				headers: {'Content-Type': 'application/json', 'X-Node-Cache': 'MISS'}
			})
		} else {
			logger.debug('Node retrieved from KV cache', {nodeId});
		}

		logger.info('Node retrieved successfully', {nodeId});

		return new Response(nodeData, {
			headers: {'Content-Type': 'application/json', 'X-Node-Cache': 'HIT'}
		});
	} catch (error) {
		logger.error('Failed to retrieve node', error);
		throw error;
	}
}

export async function createNode(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Creating new node');

	try {
		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphNode>;
		logger.performance('parse_request_body', Date.now() - parseStart);

		const nodeId = body.id ?? crypto.randomUUID();
		const timestamp = new Date().toISOString();

		const node: GraphNode = {
			id: nodeId,
			type: body.type ?? 'default',
			properties: body.properties ?? {},
			created_at: timestamp,
			updated_at: timestamp
		};

		logger.debug('Node data prepared', {nodeId, type: node.type});

		// Store in D1 for relational queries
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			INSERT INTO ${NODES_TABLE} (id, type, properties, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
		`).bind(
			node.id,
			node.type,
			JSON.stringify(node.properties),
			node.created_at,
			node.updated_at
		).run();
		logger.performance('d1_insert', Date.now() - d1Start);

		// Cache in KV for fast access
		const kvStart = Date.now();
		await env.GRAPH_KV.put(`node:${nodeId}`, JSON.stringify(node));
		logger.performance('kv_cache_node', Date.now() - kvStart);

		// Store node type mapping for efficient queries
		const typeStart = Date.now();
		const typeKey = `type:${node.type}`;
		const existingNodes = await env.GRAPH_KV.get(typeKey);
		const nodeIds = existingNodes ? JSON.parse(existingNodes) : [];
		nodeIds.push(nodeId);
		await env.GRAPH_KV.put(typeKey, JSON.stringify(nodeIds));
		logger.performance('kv_update_type_mapping', Date.now() - typeStart);

		logger.info('Node created successfully', {nodeId, type: node.type});

		return new Response(JSON.stringify(node), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to create node', error);
		throw error;
	}
} // Add similar tracing to other functions...
export async function getNodes(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Getting nodes list');

	try {
		const url = new URL(request.url);
		const nodeType = url.searchParams.get('type');
		const limit = parseInt(url.searchParams.get('limit') ?? '100');

		let query = `SELECT *
					 FROM ${NODES_TABLE}`;
		const params: any[] = [];

		if (nodeType) {
			query += ` WHERE type = ?`;
			params.push(nodeType);
		}

		query += ` LIMIT ?`;
		params.push(limit);

		logger.debug('Executing nodes query', {nodeType, limit});

		const queryStart = Date.now();
		const results = await env.GRAPH_DB.prepare(query).bind(...params).all();
		logger.performance('d1_nodes_query', Date.now() - queryStart, {
			resultCount: results.results?.length ?? 0
		});

		const nodes = results.results?.map((row: any) => ({
			id: row.id,
			type: row.type,
			properties: JSON.parse(row.properties),
			created_at: row.created_at,
			updated_at: row.updated_at
		})) ?? [];

		logger.info('Nodes retrieved successfully', {count: nodes.length});

		return new Response(JSON.stringify(nodes), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to get nodes', error);
		throw error;
	}
} // Continue with other functions with similar tracing patterns...
export async function updateNode(nodeId: string, request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Updating node', {nodeId});

	try {
		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphNode>;
		logger.performance('parse_update_body', Date.now() - parseStart);

		const timestamp = new Date().toISOString();

		// Get existing node
		const existingStart = Date.now();
		const existing = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ?
		`).bind(nodeId).first();
		logger.performance('get_existing_node', Date.now() - existingStart);

		if (!existing) {
			logger.warn('Node not found for update', {nodeId});
			return new Response('Node not found', {status: 404});
		}

		const updatedNode: GraphNode = {
			id: nodeId,
			type: body.type ?? existing.type as string,
			properties: {...JSON.parse(existing.properties as string), ...body.properties},
			created_at: existing.created_at as string,
			updated_at: timestamp
		};

		logger.debug('Node update prepared', {nodeId, changes: body});

		// Update in D1
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			UPDATE ${NODES_TABLE}
			SET type       = ?,
				properties = ?,
				updated_at = ?
			WHERE id = ?
		`).bind(
			updatedNode.type,
			JSON.stringify(updatedNode.properties),
			updatedNode.updated_at,
			nodeId
		).run();
		logger.performance('d1_update', Date.now() - d1Start);

		// Update cache in KV
		const kvStart = Date.now();
		await env.GRAPH_KV.put(`node:${nodeId}`, JSON.stringify(updatedNode));
		logger.performance('kv_update_cache', Date.now() - kvStart);

		// Update type mapping if the type changed
		if (body.type && body.type !== existing.type) {
			const typeMappingStart = Date.now();

			// Remove from old type mapping
			const oldTypeKey = `type:${existing.type}`;
			const oldNodes = await env.GRAPH_KV.get(oldTypeKey);
			if (oldNodes) {
				const oldNodeIds = JSON.parse(oldNodes).filter((id: string) => id !== nodeId);
				await env.GRAPH_KV.put(oldTypeKey, JSON.stringify(oldNodeIds));
			}

			// Add to new type mapping
			const newTypeKey = `type:${body.type}`;
			const newNodes = await env.GRAPH_KV.get(newTypeKey);
			const newNodeIds = newNodes ? JSON.parse(newNodes) : [];
			if (!newNodeIds.includes(nodeId)) {
				newNodeIds.push(nodeId);
				await env.GRAPH_KV.put(newTypeKey, JSON.stringify(newNodeIds));
			}

			logger.performance('update_type_mapping', Date.now() - typeMappingStart);
		}

		logger.info('Node updated successfully', {nodeId, type: updatedNode.type});

		return new Response(JSON.stringify(updatedNode), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to update node', error);
		throw error;
	}
}

export async function deleteNode(nodeId: string, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Deleting node', {nodeId});

	try {
		// Get node details before deletion for cleanup
		const nodeStart = Date.now();
		const existingNode = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ?
		`).bind(nodeId).first();
		logger.performance('get_node_for_deletion', Date.now() - nodeStart);

		if (!existingNode) {
			logger.warn('Node not found for deletion', {nodeId});
			return new Response('Node not found', {status: 404});
		}

		// Delete all edges connected to this node
		const edgesStart = Date.now();
		const connectedEdges = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${EDGES_TABLE}
			WHERE from_node = ?
			   OR to_node = ?
		`).bind(nodeId, nodeId).all();

		await env.GRAPH_DB.prepare(`
			DELETE
			FROM ${EDGES_TABLE}
			WHERE from_node = ?
			   OR to_node = ?
		`).bind(nodeId, nodeId).run();
		logger.performance('delete_connected_edges', Date.now() - edgesStart, {
			edgeCount: connectedEdges.results?.length ?? 0
		});

		// Delete the node
		const nodeDeleteStart = Date.now();
		await env.GRAPH_DB.prepare(`
			DELETE
			FROM ${NODES_TABLE}
			WHERE id = ?
		`).bind(nodeId).run();
		logger.performance('delete_node', Date.now() - nodeDeleteStart);

		// Clean up KV cache
		const kvCleanupStart = Date.now();
		await Promise.all([
			env.GRAPH_KV.delete(`node:${nodeId}`),
			env.GRAPH_KV.delete(`adj:out:${nodeId}`),
			env.GRAPH_KV.delete(`adj:in:${nodeId}`)
		]);

		// Clean up edge caches
		if (connectedEdges.results) {
			for (const edge of connectedEdges.results) {
				await env.GRAPH_KV.delete(`edge:${edge.id}`);
			}
		}

		// Remove from type mapping
		const nodeType = existingNode.type as string;
		const typeKey = `type:${nodeType}`;
		const existingNodes = await env.GRAPH_KV.get(typeKey);
		if (existingNodes) {
			const nodeIds = JSON.parse(existingNodes).filter((id: string) => id !== nodeId);
			await env.GRAPH_KV.put(typeKey, JSON.stringify(nodeIds));
		}

		logger.performance('kv_cleanup', Date.now() - kvCleanupStart);

		const result = {
			deleted: nodeId,
			deleted_edges: connectedEdges.results?.length ?? 0,
			timestamp: new Date().toISOString()
		};

		logger.info('Node deleted successfully', result);

		return new Response(JSON.stringify(result), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to delete node', error);
		throw error;
	}
}
