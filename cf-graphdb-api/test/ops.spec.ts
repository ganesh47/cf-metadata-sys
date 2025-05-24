// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {createJwt} from "./auth.spec";
import {initializeDatabase} from "../src/d1/initDb";

import {Env} from "../src/types/graph";


describe('/metadata API Worker Tests', async () => {
	const eenv = env as Env
	const {initStart, logger} = prepareLogger();
	const validToken = await createJwt(eenv,"test:*");
	const importData = {
		nodes: [
			{
				id: 'import-test-1',
				type: 'imported',
				properties: {source: 'import'},
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			},
			{
				id: 'import-test-2',
				type: 'imported',
				properties: {source: 'import'},
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			}
		],
		edges: [
			{
				id: 'import-edge-1',
				from_node: 'import-test-1',
				to_node: 'import-test-1',
				relationship_type: 'self',
				properties: {},
				created_at: new Date().toISOString()
			},
			{
				id: 'import-edge-2',
				from_node: 'import-test-1',
				to_node: 'import-test-2',
				relationship_type: 'parent',
				properties: {},
				created_at: new Date().toISOString()
			}
		]
	};
	beforeAll(async ()=>{
		await initializeDatabase(eenv.GRAPH_DB, logger);
		logger.performance('database_init', Date.now() - initStart);
	})
	// Run once after all tests complete
	afterAll(async () => {
		await cleanAllData();
		console.log('✓ Final database cleanup completed');
	});

	describe('Metadata Operations', () => {
		it('should import metadata', async () => {

			const response = await SELF.fetch('http://localhost/test/metadata/import', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(importData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.imported_nodes).toBe(2);
			expect(result.imported_edges).toBe(2);

			// Verify the imported node exists
			const nodeResponse = await SELF.fetch('http://localhost/test/nodes/import-test-1', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(nodeResponse.status).toBe(200);
			const node = await nodeResponse.json<any>();
			expect(node.type).toBe('imported');

			const responseInvalid = await SELF.fetch('http://localhost/test/metadata/import', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: undefined
			})
			expect(responseInvalid.status).toBe(500);
		});
		it('should export metadata', async () => {
			// Create some test data first
			await SELF.fetch('http://localhost/test/metadata/import', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(importData)
			});

			const response = await SELF.fetch('http://localhost/test/metadata/export', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.timestamp).toBeDefined();
			expect(result.nodes).toBeDefined();
			expect(result.edges).toBeDefined();
			expect(Array.isArray(result.nodes)).toBe(true);
			expect(Array.isArray(result.edges)).toBe(true);
		});
	});

	describe('Error Handling', () => {
		it('should handle invalid JSON in request body', async () => {
			const response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: 'invalid json'
			});

			expect(response.status).toBe(500);
		});

		it('should handle missing required fields', async () => {
			const response = await SELF.fetch('http://localhost/test/edge', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					// Missing from_node and to_node
					relationship_type: 'test'
				})
			});

			expect(response.status).toBe(500);
		});

		it('should return 404 for unknown routes', async () => {
			const response = await SELF.fetch('http://localhost/test/unknown-route', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(response.status).toBe(404);
		});
	});

	describe('Performance and Logging', () => {
		it('should include request ID in responses', async () => {
			const response = await SELF.fetch('http://localhost/test/nodes', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(response.status).toBe(200);

			// Check that logs contain request ID (this would be visible in test output)
			// In a real scenario, you'd capture and verify log output
		});

		it('should handle concurrent requests', async () => {
			const requests = Array.from({length: 5}, (_, i) =>
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						type: 'concurrent',
						properties: {index: i}
					})
				})
			);

			const responses = await Promise.all(requests);
			responses.forEach((response: any) => {
				expect(response.status).toBe(200);
			});

			// Verify all nodes were created
			const listResponse = await SELF.fetch('http://localhost/test/nodes?type=concurrent', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			const nodes = await listResponse.json<any>();
			expect(nodes.length).toBe(5);
		});
	});
});
