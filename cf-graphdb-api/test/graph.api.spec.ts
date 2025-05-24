// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {createJwt} from "./auth.spec";
import {initializeDatabase} from "../src/d1/initDb";

describe('/graph API GraphDB Worker Tests', async () => {
	const eenv = env as any
	const validToken = await createJwt(eenv,"test:*");
	const {initStart, logger} = prepareLogger();
	beforeAll(async ()=>{
		await initializeDatabase(eenv.GRAPH_DB, logger);
		logger.performance('database_init', Date.now() - initStart);
	})
	// Run once after all tests complete
	afterAll(async () => {
		await cleanAllData();
		console.log('✓ Final database cleanup completed');
	});
	describe('Graph Query Operations', () => {
		beforeEach(async () => {
			// Set up the test graph
			const users = await Promise.all([
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						type: 'user',
						properties: {name: 'Alice', role: 'admin'}
					})
				}).then((r: any) => r.json() as Promise<any>),
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						type: 'user',
						properties: {name: 'Bob', role: 'user'}
					})
				}).then((r: any) => r.json()),
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						type: 'document',
						properties: {title: 'Important Doc'}
					})
				}).then((r: any) => r.json())
			]);

			// Create relationships
			await Promise.all([
				SELF.fetch('http://localhost/test/edges', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						from_node: users[0].id,
						to_node: users[1].id,
						relationship_type: 'manages'
					})
				}),
				SELF.fetch('http://localhost/test/edges', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						from_node: users[1].id,
						to_node: users[2].id,
						relationship_type: 'authored'
					})
				})
			]);
		});

		it('should execute graph queries', async () => {
			const queryData = {
				node_type: 'user',
				limit: 10
			};

			const response = await SELF.fetch('http://localhost/test/query', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(queryData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.nodes).toBeDefined();
			expect(result.edges).toBeDefined();
			expect(result.metadata).toBeDefined();
			expect(result.metadata.total_nodes).toBeGreaterThan(0);
			expect(result.metadata.query_time_ms).toBeGreaterThan(0);
		});

		it('should traverse graph from starting node', async () => {
			// Get a user node ID for traversal
			const nodesResponse = await SELF.fetch('http://localhost/test/nodes?type=user&limit=1', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			const nodes = await nodesResponse.json<any>();
			const startNodeId = nodes[0].id;

			const traversalData = {
				start_node: startNodeId,
				max_depth: 2
			};

			const response = await SELF.fetch('http://localhost/test/traverse', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(traversalData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.nodes).toBeDefined();
			expect(result.edges).toBeDefined();
			expect(result.paths).toBeDefined();
			expect(Array.isArray(result.nodes)).toBe(true);
			expect(Array.isArray(result.edges)).toBe(true);
			expect(Array.isArray(result.paths)).toBe(true);
		});
	});
});
