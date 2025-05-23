import GraphNode, {Env, GraphEdge, QueryResult} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";

export async function updateAdjacencyList(env: Env, fromNode: string, toNode: string, relationshipType: string, logger: Logger): Promise<void> {
	logger.debug('Updating adjacency lists', {fromNode, toNode, relationshipType});

	try {
		// Outgoing edges from fromNode
		const outgoingKey = `adj:out:${fromNode}`;
		const existingOutgoing = await env.GRAPH_KV.get(outgoingKey);
		const outgoingList = existingOutgoing ? JSON.parse(existingOutgoing) : [];
		outgoingList.push({node: toNode, type: relationshipType});
		await env.GRAPH_KV.put(outgoingKey, JSON.stringify(outgoingList));

		// Incoming edges to toNode
		const incomingKey = `adj:in:${toNode}`;
		const existingIncoming = await env.GRAPH_KV.get(incomingKey);
		const incomingList = existingIncoming ? JSON.parse(existingIncoming) : [];
		incomingList.push({node: fromNode, type: relationshipType});
		await env.GRAPH_KV.put(incomingKey, JSON.stringify(incomingList));

		logger.debug('Adjacency lists updated', {
			outgoingCount: outgoingList.length,
			incomingCount: incomingList.length
		});
	} catch (error) {
		logger.error('Failed to update adjacency lists', error);
		throw error;
	}
}

export async function queryGraph(request: Request, env: Env, logger: Logger): Promise<Response> {
	const startTime = Date.now();
	logger.debug('Starting graph query');

	try {
		const parseStart = Date.now();
		const body = await request.json() as {
			node_type?: string;
			relationship_type?: string;
			properties?: Record<string, any>;
			limit?: number;
		};
		logger.performance('parse_query_body', Date.now() - parseStart);

		let query = `
			SELECT n.*, e.id as edge_id, e.from_node, e.to_node, e.relationship_type, e.properties as edge_properties
			FROM ${NODES_TABLE} n
					 LEFT JOIN ${EDGES_TABLE} e ON n.id = e.from_node OR n.id = e.to_node
			WHERE 1 = 1
		`;

		const params: any[] = [];

		if (body.node_type) {
			query += ` AND n.type = ?`;
			params.push(body.node_type);
		}

		if (body.relationship_type) {
			query += ` AND e.relationship_type = ?`;
			params.push(body.relationship_type);
		}

		if (body.limit) {
			query += ` LIMIT ?`;
			params.push(body.limit);
		}

		logger.debug('Executing graph query', {
			nodeType: body.node_type,
			relationshipType: body.relationship_type,
			limit: body.limit,
			paramCount: params.length
		});

		const queryStart = Date.now();
		const results = await env.GRAPH_DB.prepare(query).bind(...params).all();
		logger.performance('d1_graph_query', Date.now() - queryStart, {
			resultCount: results.results?.length ?? 0
		});

		const processStart = Date.now();
		const nodesMap = new Map<string, GraphNode>();
		const edgesMap = new Map<string, GraphEdge>();

		results.results?.forEach((row: any) => {
			// Process node
			if (!nodesMap.has(row.id)) {
				nodesMap.set(row.id, {
					id: row.id,
					type: row.type,
					properties: JSON.parse(row.properties),
					created_at: row.created_at,
					updated_at: row.updated_at
				});
			}

			// Process edge if exists
			if (row.edge_id && !edgesMap.has(row.edge_id)) {
				edgesMap.set(row.edge_id, {
					id: row.edge_id,
					from_node: row.from_node,
					to_node: row.to_node,
					relationship_type: row.relationship_type,
					properties: JSON.parse(row.edge_properties ?? '{}'),
					created_at: row.created_at
				});
			}
		});
		logger.performance('process_query_results', Date.now() - processStart);

		const queryResult: QueryResult = {
			nodes: Array.from(nodesMap.values()),
			edges: Array.from(edgesMap.values()),
			metadata: {
				total_nodes: nodesMap.size,
				total_edges: edgesMap.size,
				query_time_ms: Date.now() - startTime
			}
		};

		logger.info('Graph query completed', {
			nodeCount: queryResult.nodes.length,
			edgeCount: queryResult.edges.length,
			totalDuration: Date.now() - startTime
		});

		return new Response(JSON.stringify(queryResult), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Graph query failed', error);
		throw error;
	}
}

// Add similar tracing to other functions...
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
export async function getEdges(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Getting edges list');

	try {
		const url = new URL(request.url);
		const relationshipType = url.searchParams.get('type');
		const fromNode = url.searchParams.get('from');
		const toNode = url.searchParams.get('to');
		const limit = parseInt(url.searchParams.get('limit') ?? '100');

		let query = `SELECT *
					 FROM ${EDGES_TABLE}
					 WHERE 1 = 1`;
		const params: any[] = [];

		if (relationshipType) {
			query += ` AND relationship_type = ?`;
			params.push(relationshipType);
		}

		if (fromNode) {
			query += ` AND from_node = ?`;
			params.push(fromNode);
		}

		if (toNode) {
			query += ` AND to_node = ?`;
			params.push(toNode);
		}

		query += ` LIMIT ?`;
		params.push(limit);

		logger.debug('Executing edges query', {relationshipType, fromNode, toNode, limit});

		const queryStart = Date.now();
		const results = await env.GRAPH_DB.prepare(query).bind(...params).all();
		logger.performance('d1_edges_query', Date.now() - queryStart, {
			resultCount: results.results?.length ?? 0
		});

		const edges = results.results?.map((row: any) => ({
			id: row.id,
			from_node: row.from_node,
			to_node: row.to_node,
			relationship_type: row.relationship_type,
			properties: JSON.parse(row.properties),
			created_at: row.created_at
		})) ?? [];

		logger.info('Edges retrieved successfully', {count: edges.length});

		return new Response(JSON.stringify(edges), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to get edges', error);
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
}

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
				headers: {'Content-Type': 'application/json','X-Node-Cache':'MISS'}
			})
		} else {
			logger.debug('Node retrieved from KV cache', {nodeId});
		}

		logger.info('Node retrieved successfully', {nodeId});

		return new Response(nodeData, {
			headers: {'Content-Type': 'application/json','X-Node-Cache':'HIT'}
		});
	} catch (error) {
		logger.error('Failed to retrieve node', error);
		throw error;
	}
}

export async function createEdge(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Creating new edge');

	try {
		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphEdge>;
		logger.performance('parse_request_body', Date.now() - parseStart);

		const edgeId = body.id ?? crypto.randomUUID();
		const timestamp = new Date().toISOString();

		const edge: GraphEdge = {
			id: edgeId,
			from_node: body.from_node!,
			to_node: body.to_node!,
			relationship_type: body.relationship_type ?? 'related',
			properties: body.properties ?? {},
			created_at: timestamp
		};

		logger.debug('Edge data prepared', {
			edgeId,
			fromNode: edge.from_node,
			toNode: edge.to_node,
			type: edge.relationship_type
		});

		// Store in D1
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			INSERT INTO ${EDGES_TABLE} (id, from_node, to_node, relationship_type, properties, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`).bind(
			edge.id,
			edge.from_node,
			edge.to_node,
			edge.relationship_type,
			JSON.stringify(edge.properties),
			edge.created_at
		).run();
		logger.performance('d1_insert_edge', Date.now() - d1Start);

		// Cache edge relationships in KV
		const kvStart = Date.now();
		await env.GRAPH_KV.put(`edge:${edgeId}`, JSON.stringify(edge));
		logger.performance('kv_cache_edge', Date.now() - kvStart);

		// Update adjacency lists for fast traversal
		const adjStart = Date.now();
		await updateAdjacencyList(env, edge.from_node, edge.to_node, edge.relationship_type, logger);
		logger.performance('update_adjacency_lists', Date.now() - adjStart);

		logger.info('Edge created successfully', {
			edgeId,
			fromNode: edge.from_node,
			toNode: edge.to_node,
			type: edge.relationship_type
		});

		return new Response(JSON.stringify(edge), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to create edge', error);
		throw error;
	}
}
// sonarignore: typescript:S107
async function traverseNode(
	env: Env,
	nodeId: string,
	currentDepth: number,
	maxDepth: number,
	visited: Set<string>,
	result: { nodes: GraphNode[], edges: GraphEdge[], paths: string[][] },
	currentPath: string[],
	relationshipTypes?: string[],
	logger?: Logger
): Promise<void> {
	if (currentDepth >= maxDepth || visited.has(nodeId)) {
		if (currentPath.length > 1) {
			result.paths.push([...currentPath]);
		}
		return;
	}

	visited.add(nodeId);

	// Get node details
	try {
		const nodeStart = Date.now();
		const nodeResult = await env.GRAPH_DB.prepare(`
      SELECT * FROM ${NODES_TABLE} WHERE id = ?
    `).bind(nodeId).first();

		if (nodeResult) {
			const node: GraphNode = {
				id: nodeResult.id as string,
				type: nodeResult.type as string,
				properties: JSON.parse(nodeResult.properties as string),
				created_at: nodeResult.created_at as string,
				updated_at: nodeResult.updated_at as string
			};
			result.nodes.push(node);
		}
		logger?.performance('traverse_node_lookup', Date.now() - nodeStart);

		// Get adjacent nodes from KV adjacency list
		const adjStart = Date.now();
		const adjacencyData = await env.GRAPH_KV.get(`adj:out:${nodeId}`);
		logger?.performance('traverse_adjacency_lookup', Date.now() - adjStart);

		if (adjacencyData) {
			const adjacentNodes = JSON.parse(adjacencyData) as { node: string, type: string }[];

			for (const adjacent of adjacentNodes) {
				if (relationshipTypes && !relationshipTypes.includes(adjacent.type)) {
					continue;
				}

				// Get edge details
				const edgeStart = Date.now();
				const edgeQuery = await env.GRAPH_DB.prepare(`
          SELECT * FROM ${EDGES_TABLE} WHERE from_node = ? AND to_node = ? AND relationship_type = ?
        `).bind(nodeId, adjacent.node, adjacent.type).first();
				logger?.performance('traverse_edge_lookup', Date.now() - edgeStart);

				if (edgeQuery) {
					const edge: GraphEdge = {
						id: edgeQuery.id as string,
						from_node: edgeQuery.from_node as string,
						to_node: edgeQuery.to_node as string,
						relationship_type: edgeQuery.relationship_type as string,
						properties: JSON.parse(edgeQuery.properties as string),
						created_at: edgeQuery.created_at as string
					};
					result.edges.push(edge);
				}

				await traverseNode(
					env,
					adjacent.node,
					currentDepth + 1,
					maxDepth,
					visited,
					result,
					[...currentPath, adjacent.node],
					relationshipTypes,
					logger
				);
			}
		}
	} catch (error) {
		logger?.error('Error during node traversal', { nodeId, error });
	}
}


export async function traverseGraph(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Starting graph traversal');

	try {
		const parseStart = Date.now();
		const body = await request.json() as {
			start_node: string;
			max_depth?: number;
			relationship_types?: string[];
		};
		logger.performance('parse_traversal_body', Date.now() - parseStart);

		const maxDepth = body.max_depth ?? 3;
		const visited = new Set<string>();
		const result: { nodes: GraphNode[], edges: GraphEdge[], paths: string[][] } = {
			nodes: [],
			edges: [],
			paths: []
		};

		logger.debug('Traversal parameters', {
			startNode: body.start_node,
			maxDepth,
			relationshipTypes: body.relationship_types
		});

		const traversalStart = Date.now();
		await traverseNode(env, body.start_node, 0, maxDepth, visited, result, [body.start_node], body.relationship_types, logger);
		logger.performance('graph_traversal', Date.now() - traversalStart, {
			nodesFound: result.nodes.length,
			edgesFound: result.edges.length,
			pathsFound: result.paths.length
		});

		logger.info('Graph traversal completed', {
			startNode: body.start_node,
			nodeCount: result.nodes.length,
			edgeCount: result.edges.length,
			pathCount: result.paths.length
		});

		return new Response(JSON.stringify(result), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Graph traversal failed', error);
		throw error;
	}
}

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
