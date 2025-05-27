import GraphNode, {Env, GraphEdge, OrgParams} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";

export async function importMetadata(request: Request, env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Starting metadata import', { orgId });

	try {
		// Extract user info for audit trail
		const userId = request.headers.get('X-User-ID') || 'system';
		const userAgent = request.headers.get('User-Agent') || 'unknown';
		const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

		const parseStart = Date.now();
		const importData = await request.json() as {
			nodes: GraphNode[];
			edges: GraphEdge[];
		};
		logger.performance('parse_import_data', Date.now() - parseStart);

		logger.debug('Import data received', {
			orgId,
			nodeCount: importData.nodes.length,
			edgeCount: importData.edges.length
		});

		// Import nodes
		const nodesStart = Date.now();
		for (const node of importData.nodes) {
			// Set org scope and audit metadata if not present
			node.org_id = node.org_id || orgId;
			node.created_by = node.created_by || userId;
			node.updated_by = node.updated_by || userId;
			node.user_agent = node.user_agent || userAgent;
			node.client_ip = node.client_ip || clientIp;

			// Language=SQL
			await env.GRAPH_DB.prepare(`
        INSERT OR REPLACE INTO ${NODES_TABLE} (
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

			// Update KV cache
			await env.GRAPH_KV.put(`node:${node.org_id}:${node.id}`, JSON.stringify(node));

			// Update type mapping
			const typeKey = `type:${node.org_id}:${node.type}`;
			const existingNodes = await env.GRAPH_KV.get(typeKey);
			const nodeIds = existingNodes ? JSON.parse(existingNodes) : [];
			if (!nodeIds.includes(node.id)) {
				nodeIds.push(node.id);
				await env.GRAPH_KV.put(typeKey, JSON.stringify(nodeIds));
			}
		}
		logger.performance('import_nodes', Date.now() - nodesStart);

		// Import edges
		const edgesStart = Date.now();
		for (const edge of importData.edges) {
			// Set org scope and audit metadata if not present
			edge.org_id = edge.org_id || orgId;
			edge.created_by = edge.created_by || userId;
			edge.updated_by = edge.updated_by || userId;
			edge.updated_at = edge.updated_at || edge.created_at;
			edge.user_agent = edge.user_agent || userAgent;
			edge.client_ip = edge.client_ip || clientIp;

			await env.GRAPH_DB.prepare(`
        INSERT OR REPLACE INTO ${EDGES_TABLE} (
          id, org_id, from_node, to_node, relationship_type, properties, created_at,
          updated_at, created_by, updated_by, user_agent, client_ip
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

		}
		logger.performance('import_edges', Date.now() - edgesStart);

		const result = {
			org_id: orgId,
			imported_nodes: importData.nodes.length,
			imported_edges: importData.edges.length,
			timestamp: new Date().toISOString(),
			imported_by: userId
		};

		logger.info('Metadata import completed', result);

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		logger.error('Metadata import failed', { orgId });
		throw error;
	}
}

export async function exportMetadata(env: Env, logger: Logger, params: OrgParams): Promise<Response> {
	const { orgId } = params;
	logger.debug('Starting metadata export', { orgId });

	try {
		const timestamp = new Date().toISOString();
		const exportKey = `export-${orgId}-${timestamp}.json`;

		// Get all nodes and edges from D1 for this organization
		const nodesStart = Date.now();
		const nodesResult = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${NODES_TABLE}
			WHERE org_id = ?
		`).bind(orgId).all();
		logger.performance('export_nodes_query', Date.now() - nodesStart, {
			nodeCount: nodesResult.results?.length ?? 0
		});

		const edgesStart = Date.now();
		const edgesResult = await env.GRAPH_DB.prepare(`
			SELECT *
			FROM ${EDGES_TABLE}
			WHERE org_id = ?
		`).bind(orgId).all();
		logger.performance('export_edges_query', Date.now() - edgesStart, {
			edgeCount: edgesResult.results?.length ?? 0
		});

		const exportData = {
			timestamp,
			version: '1.0',
			org_id: orgId,
			nodes: nodesResult.results?.map((row: any) => ({
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
			})) ?? [],
			edges: edgesResult.results?.map((row: any) => ({
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
			})) ?? []
		};

		// Store in R2 for backup
		const r2Start = Date.now();
		await env.GRAPH_BUCKET.put(exportKey, JSON.stringify(exportData), {
			httpMetadata: {
				contentType: 'application/json',
			},
			customMetadata: {
				exportedAt: timestamp,
				orgId: orgId,
				nodeCount: exportData.nodes.length.toString(),
				edgeCount: exportData.edges.length.toString()
			}
		});
		logger.performance('r2_backup_store', Date.now() - r2Start);

		logger.info('Metadata export completed', {
			orgId,
			exportKey,
			nodeCount: exportData.nodes.length,
			edgeCount: exportData.edges.length
		});

		return new Response(JSON.stringify(exportData), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Metadata export failed', { orgId });
		throw error;
	}
}
