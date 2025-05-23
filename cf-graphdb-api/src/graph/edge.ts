import {Env, GraphEdge} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE} from "../constants";
import {updateAdjacencyList} from "./traversals";

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
