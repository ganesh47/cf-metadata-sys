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

