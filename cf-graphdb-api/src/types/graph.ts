export interface GraphEdge {
	id: string;
	from_node: string;
	to_node: string;
	relationship_type: string;
	properties: Record<string, any>;
	created_at: string;
}
export interface Env {
	LOG_LEVEL: string;
	GRAPH_KV: KVNamespace;
	GRAPH_BUCKET: R2Bucket;
	GRAPH_DB: D1Database;
	GRAPH_OBJECTS: DurableObjectNamespace;
}

export default interface GraphNode {
	id: string;
	type: string;
	properties: Record<string, any>;
	created_at: string;
	updated_at: string;
}

export interface QueryResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	metadata: {
		total_nodes: number;
		total_edges: number;
		query_time_ms: number;
	};
}

export interface TraceContext {
	requestId: string;
	operation: string;
	startTime: number;
	metadata: Record<string, any>;
}
