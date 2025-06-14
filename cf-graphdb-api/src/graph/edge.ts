import {Env, GraphEdge, OrgParams} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE} from "../constants";

import { QdrantClient } from "@qdrant/js-client-rest";
import { embedTextUsingTogetherAI } from "../utils/embed";

export async function createEdge(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Creating new edge', { orgId });

	try {
		const userId = request.headers.get('X-User-ID') ?? 'system';
		const userAgent = request.headers.get('User-Agent') ?? 'unknown';
		const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

		const parseStart = Date.now();
		const body = await request.json() as Partial<GraphEdge>;
		logger.performance('parse_request_body', Date.now() - parseStart);

		const edgeId = body.id ?? crypto.randomUUID();
		const timestamp = new Date().toISOString();

		const edge: GraphEdge = {
			id: edgeId,
			org_id: orgId,
			from_node: body.from_node!,
			to_node: body.to_node!,
			relationship_type: body.relationship_type ?? 'related',
			properties: body.properties ?? {},
			created_at: timestamp,
			updated_at: timestamp,
			created_by: userId,
			updated_by: userId,
			user_agent: userAgent,
			client_ip: clientIp
		};

		logger.debug('Edge data prepared', {
			orgId,
			edgeId,
			fromNode: edge.from_node,
			toNode: edge.to_node,
			type: edge.relationship_type,
			createdBy: userId
		});

		// Store in D1
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			INSERT INTO ${EDGES_TABLE} (
				id, org_id, from_node, to_node, relationship_type, properties,
				created_at, updated_at, created_by, updated_by,
				user_agent, client_ip
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id,org_id) DO UPDATE SET
				org_id = excluded.org_id,
											  from_node = excluded.from_node,
											  to_node = excluded.to_node,
											  relationship_type = excluded.relationship_type,
											  properties = excluded.properties,
											  updated_at = excluded.updated_at,
											  updated_by = excluded.updated_by,
											  user_agent = excluded.user_agent,
											  client_ip = excluded.client_ip
		`).bind(
			edge.id,
			edge.org_id,
			edge.from_node,
			edge.to_node,
			edge.relationship_type,
			JSON.stringify(edge.properties),
			edge.created_at,
			edge.updated_at,
			edge.created_by,
			edge.updated_by,
			edge.user_agent,
			edge.client_ip
		).run();
		logger.performance('d1_insert_edge', Date.now() - d1Start);

		// Embed specified vectorizable properties
		const vectorChunks: string[] = [];
		const vectorKeys = Array.isArray(edge.properties.vectorize) ? edge.properties.vectorize : [];

		for (const key of vectorKeys) {
			if (key in edge.properties) {
				const value = edge.properties[key];
				const normalizedKey = key.toLowerCase().replace(/_/g, ' ');

				if (typeof value === 'string') {
					vectorChunks.push(`${normalizedKey}: ${value.toLowerCase()}`);
				} else if (typeof value === 'object' && value !== null) {
					const description = typeof value.description === 'string' ? value.description : JSON.stringify(value);
					vectorChunks.push(`${normalizedKey}: ${description.toLowerCase()}`);
				}
			}
		}

		if (vectorChunks.length > 0) {
			const textToEmbed = vectorChunks.join("\n\n");
			const embedding = await embedTextUsingTogetherAI(textToEmbed, env.TOGETHER_API_KEY);

			const qdrant = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY });
			await qdrant.upsert(env.QDRANT_EDGE_COLLECTION, {
				points: [
					{
						id: edgeId,
						vector: embedding,
						payload: {
							edge_id: edgeId,
							from_node: edge.from_node,
							to_node: edge.to_node,
							org_id: orgId,
							relationship_type: edge.relationship_type
						}
					}
				]
			});
		}

		logger.info('Edge created and embedded successfully', { edgeId });

		return new Response(JSON.stringify(edge), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error:any) {
		logger.error('Failed to create edge', { orgId, error });
		return new Response(JSON.stringify({ error: error.message }), { status: 500 });
	}
}

export async function getEdges(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Getting edges list', { orgId });

	try {
		const url = new URL(request.url);
		const relationshipType = url.searchParams.get('type');
		const fromNode = url.searchParams.get('from');
		const toNode = url.searchParams.get('to');
		const limit = parseInt(url.searchParams.get('limit') ?? '100');

		let query = `SELECT *
					 FROM ${EDGES_TABLE}
					 WHERE org_id = ?`;
		const queryParams: any[] = [orgId];

		if (relationshipType) {
			query += ` AND relationship_type = ?`;
			queryParams.push(relationshipType);
		}

		if (fromNode) {
			query += ` AND from_node = ?`;
			queryParams.push(fromNode);
		}

		if (toNode) {
			query += ` AND to_node = ?`;
			queryParams.push(toNode);
		}

		query += ` LIMIT ?`;
		queryParams.push(limit);

		logger.debug('Executing edges query', {
			orgId,
			relationshipType,
			fromNode,
			toNode,
			limit
		});

		const queryStart = Date.now();
		const results = await env.GRAPH_DB.prepare(query).bind(...queryParams).all();
		logger.performance('d1_edges_query', Date.now() - queryStart, {
			resultCount: results.results?.length ?? 0
		});

		const edges = results.results?.map((row: any) => ({
			id: row.id,
			org_id: row.org_id,
			from_node: row.from_node,
			to_node: row.to_node,
			relationship_type: row.relationship_type,
			properties: JSON.parse(row.properties),
			created_at: row.created_at,
			updated_at: row.updated_at,
			created_by: row.created_by,
			updated_by: row.updated_by,
			user_agent: row.user_agent,
			client_ip: row.client_ip
		})) ?? [];

		logger.info('Edges retrieved successfully', { orgId, count: edges.length });

		return new Response(JSON.stringify({
			edges,
			metadata: {
				org_id: orgId,
				total: edges.length,
				filters: {
					relationship_type: relationshipType,
					from_node: fromNode,
					to_node: toNode,
					limit
				}
			}
		}), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to get edges', { orgId });
		throw error;
	}
}

export async function getEdge(edgeId: string, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Getting edge details', { orgId, edgeId });

	try {
		// If not in cache, get from database
		const queryStart = Date.now();
		const result = await env.GRAPH_DB.prepare(`
			SELECT * FROM ${EDGES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(edgeId, orgId).first();
		logger.performance('d1_edge_lookup', Date.now() - queryStart);

		if (!result) {
			logger.warn('Edge not found', { orgId, edgeId });
			return new Response(JSON.stringify({
				error: 'Edge not found',
				edgeId,
				orgId
			}), {
				status: 404,
				headers: {'Content-Type': 'application/json'}
			});
		}

		const edge: GraphEdge = {
			id: result.id as string,
			org_id: result.org_id as string,
			from_node: result.from_node as string,
			to_node: result.to_node as string,
			relationship_type: result.relationship_type as string,
			properties: JSON.parse(result.properties as string),
			created_at: result.created_at as string,
			updated_at: result.updated_at as string,
			created_by: result.created_by as string,
			updated_by: result.updated_by as string,
			user_agent: result.user_agent as string,
			client_ip: result.client_ip as string
		};


		logger.info('Edge retrieved successfully', { orgId, edgeId });

		return new Response(JSON.stringify(edge), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to get edge', { orgId, edgeId });
		throw error;
	}
}

export async function updateEdge(
	edgeId: string,
	request: Request,
	env: Env,
	logger: Logger,
	params: OrgParams
): Promise<Response> {
	const { orgId } = params;
	logger.debug('Updating edge', { orgId, edgeId });

	try {
		// Extract user info for audit trail
		const userId = request.headers.get('X-User-ID') ?? 'system';
		const userAgent = request.headers.get('User-Agent') ?? 'unknown';
		const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

		// Verify edge exists and belongs to this org
		const existingEdge = await env.GRAPH_DB.prepare(`
			SELECT * FROM ${EDGES_TABLE} WHERE id = ? AND org_id = ?
		`).bind(edgeId, orgId).first();

		if (!existingEdge) {
			logger.warn('Edge not found or not authorized', { orgId, edgeId });
			return new Response(JSON.stringify({
				error: 'Edge not found or not authorized',
				edgeId,
				orgId
			}), {
				status: 404,
				headers: {'Content-Type': 'application/json'}
			});
		}

		const parseStart = Date.now();
		const updates = await request.json() as {
			relationship_type?: string;
			properties?: Record<string, any>;
		};
		logger.performance('parse_request_body', Date.now() - parseStart);

		const timestamp = new Date().toISOString();

		// Prepare update fields
		const relationshipType:string = updates.relationship_type ?? existingEdge.relationship_type as string;
		const properties = updates.properties ?
			{ ...JSON.parse(existingEdge.properties as string), ...updates.properties } :
			JSON.parse(existingEdge.properties as string);

		// Update in database
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			UPDATE ${EDGES_TABLE}
			SET relationship_type = ?,
				properties = ?,
				updated_at = ?,
				updated_by = ?,
				user_agent = ?,
				client_ip = ?
			WHERE id = ? AND org_id = ?
		`).bind(
			relationshipType,
			JSON.stringify(properties),
			timestamp,
			userId,
			userAgent,
			clientIp,
			edgeId,
			orgId
		).run();
		logger.performance('d1_update_edge', Date.now() - d1Start);

		// Create updated edge object
		const updatedEdge: GraphEdge = {
			id: edgeId,
			org_id: orgId,
			from_node: existingEdge.from_node as string,
			to_node: existingEdge.to_node as string,
			relationship_type: relationshipType,
			properties: properties,
			created_at: existingEdge.created_at as string,
			updated_at: timestamp,
			created_by: existingEdge.created_by as string,
			updated_by: userId,
			user_agent: userAgent,
			client_ip: clientIp
		};

		logger.info('Edge updated successfully', {
			orgId,
			edgeId,
			updatedBy: userId
		});

		return new Response(JSON.stringify(updatedEdge), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to update edge', { orgId, edgeId });
		throw error;
	}
}

export async function deleteEdge(
	edgeId: string,
	env: Env,
	logger: Logger,
	params: OrgParams
): Promise<Response> {
	const { orgId } = params;
	logger.debug('Deleting edge', { orgId, edgeId });

	try {
		// Get edge details before deletion for adjacency list updates
		const edgeDetails = await env.GRAPH_DB.prepare(`
			SELECT * FROM ${EDGES_TABLE} WHERE id = ? AND org_id = ?
		`).bind(edgeId, orgId).first();

		if (!edgeDetails) {
			logger.warn('Edge not found or not authorized', { orgId, edgeId });
			return new Response(JSON.stringify({
				error: 'Edge not found or not authorized',
				edgeId,
				orgId
			}), {
				status: 404,
				headers: {'Content-Type': 'application/json'}
			});
		}

		// Delete from database
		const d1Start = Date.now();
		await env.GRAPH_DB.prepare(`
			DELETE FROM ${EDGES_TABLE}
			WHERE id = ? AND org_id = ?
		`).bind(edgeId, orgId).run();
		logger.performance('d1_delete_edge', Date.now() - d1Start);


		// Update adjacency lists - need to implement removal logic
		// This would require reading, modifying, and writing back the adjacency lists
		// For simplicity, we'll just log that this should happen
		logger.info('Edge deleted, adjacency lists should be updated', {
			orgId,
			edgeId,
			fromNode: edgeDetails.from_node,
			toNode: edgeDetails.to_node,
			relationshipType: edgeDetails.relationship_type
		});

		return new Response(JSON.stringify({
			success: true,
			message: 'Edge deleted successfully',
			edgeId,
			orgId
		}), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Failed to delete edge', { orgId, edgeId });
		throw error;
	}
}
