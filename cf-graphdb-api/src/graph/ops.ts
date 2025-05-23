import GraphNode, {Env, GraphEdge} from "../types/graph";
import {Logger} from "../logger/logger";
import {EDGES_TABLE, NODES_TABLE} from "../constants";
import {updateAdjacencyList} from "./crud";

export async function importMetadata(request: Request, env: Env, logger: Logger): Promise<Response> {
	logger.debug('Starting metadata import');

	try {
		const parseStart = Date.now();
		const importData = await request.json() as {
			nodes: GraphNode[];
			edges: GraphEdge[];
		};
		logger.performance('parse_import_data', Date.now() - parseStart);

		logger.debug('Import data received', {
			nodeCount: importData.nodes.length,
			edgeCount: importData.edges.length
		});

		// Import nodes
		const nodesStart = Date.now();
		for (const node of importData.nodes) {
			// Language=SQL
			await env.GRAPH_DB.prepare(`
        INSERT OR REPLACE INTO ${NODES_TABLE} (id, type, properties, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
				node.id,
				node.type,
				JSON.stringify(node.properties),
				node.created_at,
				node.updated_at
			).run();

			// Update KV cache
			await env.GRAPH_KV.put(`node:${node.id}`, JSON.stringify(node));

			// Update type mapping
			const typeKey = `type:${node.type}`;
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
			await env.GRAPH_DB.prepare(`
        INSERT OR REPLACE INTO ${EDGES_TABLE} (id, from_node, to_node, relationship_type, properties, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
				edge.id,
				edge.from_node,
				edge.to_node,
				edge.relationship_type,
				JSON.stringify(edge.properties),
				edge.created_at
			).run();

			// Update KV cache
			await env.GRAPH_KV.put(`edge:${edge.id}`, JSON.stringify(edge));

			// Update adjacency lists
			await updateAdjacencyList(env, edge.from_node, edge.to_node, edge.relationship_type, logger);
		}
		logger.performance('import_edges', Date.now() - edgesStart);

		const result = {
			imported_nodes: importData.nodes.length,
			imported_edges: importData.edges.length,
			timestamp: new Date().toISOString()
		};

		logger.info('Metadata import completed', result);

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		logger.error('Metadata import failed', error);
		throw error;
	}
}

export async function exportMetadata(env: Env, logger: Logger): Promise<Response> {
	logger.debug('Starting metadata export');

	try {
		const timestamp = new Date().toISOString();
		const exportKey = `export-${timestamp}.json`;

		// Get all nodes and edges from D1
		const nodesStart = Date.now();
		const nodesResult = await env.GRAPH_DB.prepare(`SELECT *
														FROM ${NODES_TABLE}`).all();
		logger.performance('export_nodes_query', Date.now() - nodesStart, {
			nodeCount: nodesResult.results?.length ?? 0
		});

		const edgesStart = Date.now();
		const edgesResult = await env.GRAPH_DB.prepare(`SELECT *
														FROM ${EDGES_TABLE}`).all();
		logger.performance('export_edges_query', Date.now() - edgesStart, {
			edgeCount: edgesResult.results?.length ?? 0
		});

		const exportData = {
			timestamp,
			version: '1.0',
			nodes: nodesResult.results?.map((row: any) => ({
				id: row.id,
				type: row.type,
				properties: JSON.parse(row.properties),
				created_at: row.created_at,
				updated_at: row.updated_at
			})) ?? [],
			edges: edgesResult.results?.map((row: any) => ({
				id: row.id,
				from_node: row.from_node,
				to_node: row.to_node,
				relationship_type: row.relationship_type,
				properties: JSON.parse(row.properties),
				created_at: row.created_at
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
				nodeCount: exportData.nodes.length.toString(),
				edgeCount: exportData.edges.length.toString()
			}
		});
		logger.performance('r2_backup_store', Date.now() - r2Start);

		logger.info('Metadata export completed', {
			exportKey,
			nodeCount: exportData.nodes.length,
			edgeCount: exportData.edges.length
		});

		return new Response(JSON.stringify(exportData), {
			headers: {'Content-Type': 'application/json'}
		});
	} catch (error) {
		logger.error('Metadata export failed', error);
		throw error;
	}
}
