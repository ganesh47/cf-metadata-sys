import {D1Database, DurableObjectNamespace, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface GraphEdge {
	id: string;
	org_id: string;
	from_node: string;
	to_node: string;
	relationship_type: string;
	properties: Record<string, any>;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
	user_agent: string;
	client_ip: string;
}

export interface Env {
	ROUTER_PREFIX: string;
	CORS_ALLOWED_ORIGINS: string;
	HOME_URL: string;
    KEYCLOAK_TEST_PASS: string;
	KEYCLOAK_TEST_USER: string;
	OIDC_CLIENT_SECRET: string ;
	OIDC_CLIENT_ID: string ;
	OIDC_DISCOVERY_URL: string;
	QDRANT_API_KEY: string ;
	QDRANT_EDGE_COLLECTION: string;
    QDRANT_URL: string ;
	TOGETHER_API_KEY: string;
	INIT_DB: string;
	JWT_SECRET: string;
	LOG_LEVEL: string;
	GRAPH_KV: KVNamespace;
	GRAPH_BUCKET: R2Bucket;
	GRAPH_DB: D1Database;
	GRAPH_OBJECTS: DurableObjectNamespace;
}

export default interface GraphNode {
	id: string;
	org_id: string;
	type: string;
	properties: Record<string, any>;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
	user_agent: string;
	client_ip: string;
}

export interface QueryResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	metadata: {
		total_nodes: number;
		total_edges: number;
		query_time_ms: number;
		org_id: string;
	};
}

export interface TraceContext {
	requestId: string;
	operation: string;
	startTime: number;
	metadata: Record<string, any>;
}

export interface OrgParams {
	orgId: string;
	[key: string]: string;
}
