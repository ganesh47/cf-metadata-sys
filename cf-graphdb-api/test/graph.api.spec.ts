// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {createJwt} from "./auth.spec";
import {initializeDatabase} from "../src/d1/initDb";

describe('/graph API GraphDB Worker Tests', async () => {
	const eenv = env as any
	const validToken = await createJwt(eenv);
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
			const nodes = await Promise.all([
				{ type: 'user', properties: { name: 'Alice', role: 'admin' } },
				{ type: 'user', properties: { name: 'Bob', role: 'user' } },
				{ type: 'user', properties: { name: 'Carol', role: 'editor' } },
				{ type: 'document', properties: { title: 'Policy Doc' } },
				{ type: 'document', properties: { title: 'HR Handbook' } },
				{ type: 'tool', properties: { name: 'Internal Wiki' } }
			].map(data =>
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${validToken}`
					},
					body: JSON.stringify(data)
				}).then((res:any) => res.json())
			));

			const edgeDefs = [
				// Linear chain
				['manages', nodes[0], nodes[1]],
				['manages', nodes[1], nodes[2]],
				// Document authorship
				['authored', nodes[2], nodes[3]],
				['authored', nodes[1], nodes[4]],
				// Cross-links
				['uses', nodes[0], nodes[5]],
				['uses', nodes[2], nodes[5]],
				['references', nodes[4], nodes[3]],
				// Loop
				['mentors', nodes[2], nodes[0]]
			];

			await Promise.all(edgeDefs.map(([type, from, to]) =>
				SELF.fetch('http://localhost/test/edge', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${validToken}`
					},
					body: JSON.stringify({
						from_node: from.id,
						to_node: to.id,
						relationship_type: type
					})
				})
			));
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

		it('should traverse dense graph from starting node', async () => {
			const response = await SELF.fetch('http://localhost/test/nodes?type=user&limit=1', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			const nodes = await response.json<any>();
			const startNodeId = nodes.data[0].id;

			const traversalData = {
				start_node: startNodeId,
				max_depth: 5
			};

			const res = await SELF.fetch('http://localhost/test/traverse', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				},
				body: JSON.stringify(traversalData)
			});

			expect(res.status).toBe(200);
			const result = await res.json<any>();

			expect(Array.isArray(result.nodes)).toBe(true);
			expect(result.nodes.length).toBeGreaterThanOrEqual(4); // should see Alice, Bob, Carol, maybe docs/tools
			expect(result.edges.length).toBeGreaterThanOrEqual(4); // traversed relationship edges
			expect(Array.isArray(result.paths)).toBe(true);

			// Check if long traversal path exists
			const longPaths = result.paths.filter((p:any) => p.length >= 3);
			expect(longPaths.length).toBeGreaterThan(0);
		})
		it('should traverse dense graph using relationship type', async () => {
			const response = await SELF.fetch('http://localhost/test/nodes?type=user&limit=1', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			const nodes = await response.json<any>();
			const startNodeId = nodes.data[0].id;

			const traversalData = {
				start_node: startNodeId,
				max_depth: 5,
				relationship_types: ['manages','authored','uses','references','mentors']
			};

			const res = await SELF.fetch('http://localhost/test/traverse', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				},
				body: JSON.stringify(traversalData)
			});

			expect(res.status).toBe(200);
			const result = await res.json<any>();

			expect(Array.isArray(result.nodes)).toBe(true);
			expect(result.nodes.length).toBeGreaterThanOrEqual(4); // should see Alice, Bob, Carol, maybe docs/tools
			expect(result.edges.length).toBeGreaterThanOrEqual(4); // traversed relationship edges
			expect(Array.isArray(result.paths)).toBe(true);

			// Check if long traversal path exists
			const longPaths = result.paths.filter((p:any) => p.length >= 3);
			expect(longPaths.length).toBeGreaterThan(0);
		});

	});
});
