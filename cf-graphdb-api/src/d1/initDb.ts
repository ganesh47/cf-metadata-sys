import {Logger} from "../logger/logger";
import {NODES_TABLE, EDGES_TABLE} from "../constants";
import { D1Database } from "@cloudflare/workers-types";

export async function initializeDatabase(db: D1Database, logger: Logger): Promise<void> {
	logger.debug('Initializing database tables');
	logger.warn()
	try {
		// Create a node table with organization scope and audit metadata
		const nodesStart = Date.now();
		await db.prepare(`
      CREATE TABLE IF NOT EXISTS ${NODES_TABLE} (
        id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        user_agent TEXT,
        client_ip TEXT,
        PRIMARY KEY (id, org_id)
      )
    `).run();
		logger.performance('create_nodes_table', Date.now() - nodesStart);

		// Create edges table with organization scope and audit metadata
		const edgesStart = Date.now();
		await db.prepare(`
      CREATE TABLE IF NOT EXISTS ${EDGES_TABLE} (
        id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        properties TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT,
        updated_by TEXT,
        user_agent TEXT,
        client_ip TEXT,
        PRIMARY KEY (id, org_id),
        FOREIGN KEY (from_node, org_id) REFERENCES ${NODES_TABLE}(id, org_id),
        FOREIGN KEY (to_node, org_id) REFERENCES ${NODES_TABLE}(id, org_id)
      )
    `).run();
		logger.performance('create_edges_table', Date.now() - edgesStart);

		// Create indexes for better query performance
		const indexStart = Date.now();
		await Promise.all([
			// Node indexes
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_org_id ON ${NODES_TABLE}(org_id)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON ${NODES_TABLE}(type)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_created_by ON ${NODES_TABLE}(created_by)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_updated_by ON ${NODES_TABLE}(updated_by)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON ${NODES_TABLE}(created_at)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON ${NODES_TABLE}(updated_at)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_org_type ON ${NODES_TABLE}(org_id, type)`).run(),

			// Edge indexes
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_org_id ON ${EDGES_TABLE}(org_id)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_from ON ${EDGES_TABLE}(from_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_to ON ${EDGES_TABLE}(to_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_type ON ${EDGES_TABLE}(relationship_type)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_created_by ON ${EDGES_TABLE}(created_by)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_created_at ON ${EDGES_TABLE}(created_at)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_org_from ON ${EDGES_TABLE}(org_id, from_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_org_to ON ${EDGES_TABLE}(org_id, to_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_org_type ON ${EDGES_TABLE}(org_id, relationship_type)`).run()
		]);
		logger.performance('create_indexes', Date.now() - indexStart);

		logger.info('Database initialization completed');
	} catch (error) {
		logger.error('Database initialization failed', error);
		throw error;
	}
}
