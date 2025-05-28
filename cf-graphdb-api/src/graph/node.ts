import GraphNode, {Env, OrgParams} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";

export async function getNode(nodeId: string, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const {orgId} = params;
	logger.debug('Retrieving node', {orgId, nodeId});

	try {
		// Try KV first for fast access
		const kvStart = Date.now();
		let nodeData = await env.GRAPH_KV.get(`node:${orgId}:${nodeId}`);
		logger.performance('kv_lookup', Date.now() - kvStart, {hit: !!nodeData});

		if (nodeData) {
			// Node found in KV cache
			logger.debug('Node retrieved from KV cache', {orgId, nodeId});

			return new Response(nodeData, {
				headers: {'Content-Type': 'application/json', 'X-Node-Cache': 'HIT'}
			});
		}

		// If we get here, it means the node was not in KV
		logger.debug('Node not found in KV, checking D1', {orgId, nodeId});

		// Fallback to D1
		const d1Start = Date.now();
		const result = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ?
			  AND org_id = ?
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
		});
	} catch (error) {
		logger.error('Failed to retrieve node', {orgId, nodeId});
		throw error;
	}
}

export async function createNode(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const {orgId} = params;
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
				ON CONFLICT(id, org_id) DO UPDATE SET
				type = excluded.type,
				properties = excluded.properties,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				created_by = excluded.created_by,
				updated_by = excluded.updated_by,
				user_agent = excluded.user_agent,
				client_ip = excluded.client_ip
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
	const {orgId} = params;
	logger.debug('Getting nodes list', {orgId});

	try {
		const url = new URL(request.url);
		const nodeType = url.searchParams.get('type');
		const createdBy = url.searchParams.get('created_by');
		const updatedBy = url.searchParams.get('updated_by');
		const limit = parseInt(url.searchParams.get('limit') ?? '100');

		// Add pagination parameters
		const page = parseInt(url.searchParams.get('page') ?? '1');
		const offset = (page - 1) * limit;

		// Add sorting parameters
		const sortBy = url.searchParams.get('sort_by') ?? 'created_at';
		const sortOrder = url.searchParams.get('sort_order')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

		// First, count total matching records for pagination metadata
		let countQuery = `SELECT COUNT(*) as total
						  FROM ${NODES_TABLE}
						  WHERE org_id = ?`;
		const countParams: any[] = [orgId];

		if (nodeType) {
			countQuery += ` AND type = ?`;
			countParams.push(nodeType);
		}

		if (createdBy) {
			countQuery += ` AND created_by = ?`;
			countParams.push(createdBy);
		}

		if (updatedBy) {
			countQuery += ` AND updated_by = ?`;
			countParams.push(updatedBy);
		}

		const countStart = Date.now();
		const countResult = await env.GRAPH_DB.prepare(countQuery).bind(...countParams).first();
		logger.performance('d1_nodes_count_query', Date.now() - countStart);

		const totalRecords: number = countResult?.total as number || 0;
		const totalPages = Math.ceil(totalRecords / limit);

		// Main query for fetching nodes with pagination
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

		// Add sorting
		query += ` ORDER BY ${sortBy} ${sortOrder}`;

		// Add pagination
		query += ` LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		logger.debug('Executing nodes query', {
			orgId,
			nodeType,
			createdBy,
			updatedBy,
			limit,
			page,
			offset,
			sortBy,
			sortOrder
		});

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

		// Create pagination metadata
		const paginationMeta = {
			page,
			limit,
			total_records: totalRecords,
			total_pages: totalPages,
			has_next_page: page < totalPages,
			has_prev_page: page > 1,
			next_page: page < totalPages ? page + 1 : null,
			prev_page: page > 1 ? page - 1 : null
		};

		// Final response with nodes and pagination metadata
		const response = {
			data: nodes,
			pagination: paginationMeta
		};

		logger.info('Nodes retrieved successfully', {
			orgId,
			count: nodes.length,
			page,
			totalRecords,
			totalPages
		});

		return new Response(JSON.stringify(response), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error: any) {
		logger.error('Failed to get nodes', {orgId, error: error?.message});
		throw error;
	}
}

export async function updateNode(nodeId: string, request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const {orgId} = params;
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
			WHERE id = ?
			  AND org_id = ?
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
			WHERE id = ?
			  AND org_id = ?
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
	const {orgId} = params;
	logger.debug('Deleting node', {orgId, nodeId});

	try {
		// Get node details before deletion for cleanup
		const nodeStart = Date.now();
		const existingNode = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE id = ?
			  AND org_id = ?
		`).bind(nodeId, orgId).first();
		logger.performance('get_node_for_deletion', Date.now() - nodeStart);

		if (!existingNode) {
			logger.warn('Node not found for deletion', {orgId, nodeId});
			return new Response('Node not found', {status: 404});
		}

		// Delete all edges connected to this node
		const connectedEdges = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${EDGES_TABLE}
			WHERE from_node = ?
			  AND org_id = ?
			UNION ALL
			SELECT *
			FROM ${EDGES_TABLE}
			WHERE to_node = ?
			  AND org_id = ?;
		`).bind(nodeId, orgId, nodeId, orgId).all();
		console.log(JSON.stringify(connectedEdges));
		if (connectedEdges.results && connectedEdges.results.length > 0) {
			// Extract edge IDs for deletion
			const edgeIdSet = new Set(connectedEdges.results.map((edge: any) => edge.id));
			const edgeIds = Array.from(edgeIdSet);


			// Create placeholders for the SQL query (?, ?, ?, etc.)
			const placeholders = edgeIds.map(() => '?').join(',');

			// Delete all connected edges in a single query
			const deleteStart = Date.now();
			await env.GRAPH_DB.prepare(`
				DELETE
				FROM ${EDGES_TABLE}
				WHERE id IN (${placeholders})
				  AND org_id = ?
			`).bind(...edgeIds, orgId).run();
			logger.performance('d1_delete_connected_edges', Date.now() - deleteStart, {
				count: edgeIds.length
			});
			logger.info('Deleted connected edges', {
				orgId,
				nodeId,
				edgeCount: edgeIds.length
			});
			// Clean up edge caches
		}
		await env.GRAPH_DB.prepare(`
			DELETE
			FROM ${NODES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(nodeId, orgId).run();
		await env.GRAPH_KV.delete(`node:${orgId}:${nodeId}`);

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
