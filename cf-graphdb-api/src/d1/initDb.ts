import {Logger} from "../logger/logger";
import {NODES_TABLE,EDGES_TABLE} from "../constants";

export async function initializeDatabase(db: D1Database, logger: Logger): Promise<void> {
	logger.debug('Initializing database tables');

	try {
		// Create node table
		const nodesStart = Date.now();
		await db.prepare(`
      CREATE TABLE IF NOT EXISTS ${NODES_TABLE} (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        properties TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();
		logger.performance('create_nodes_table', Date.now() - nodesStart);

		// Create edges table
		const edgesStart = Date.now();
		await db.prepare(`
      CREATE TABLE IF NOT EXISTS ${EDGES_TABLE} (
        id TEXT PRIMARY KEY,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        properties TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (from_node) REFERENCES ${NODES_TABLE}(id),
        FOREIGN KEY (to_node) REFERENCES ${NODES_TABLE}(id)
      )
    `).run();
		logger.performance('create_edges_table', Date.now() - edgesStart);

		// Create indexes for better query performance
		const indexStart = Date.now();
		await Promise.all([
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON ${NODES_TABLE}(type)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_from ON ${EDGES_TABLE}(from_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_to ON ${EDGES_TABLE}(to_node)`).run(),
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_type ON ${EDGES_TABLE}(relationship_type)`).run()
		]);
		logger.performance('create_indexes', Date.now() - indexStart);

		logger.info('Database initialization completed');
	} catch (error) {
		logger.error('Database initialization failed', error);
		throw error;
	}
}
