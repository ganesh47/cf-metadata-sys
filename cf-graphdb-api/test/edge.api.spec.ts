// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {createJwt} from "./auth.spec";
import {Env} from "../src/types/graph";
import {initializeDatabase} from "../src/d1/initDb";

describe('/edge API GraphDB Worker Tests', async () => {
	const eenv:Env = env as Env
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
	// Your existing test suites...
	describe('Edge Operations', () => {
		let nodeId1: string;
		let nodeId2: string;



		beforeEach(async () => {
			// Create test nodes
			const node1Response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					type: 'user',
					properties: {name: 'Alice'}
				})
			});
			const node1 = await node1Response.json<any>();
			nodeId1 = node1.id;

			const node2Response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					type: 'user',
					properties: {name: 'Bob'}
				})
			});
			const node2 = await node2Response.json<any>();
			nodeId2 = node2.id;
		});

		it('should create an edge between nodes', async () => {
			const edgeData = {
				from_node: nodeId1,
				to_node: nodeId2,
				relationship_type: 'follows',
				properties: {since: '2024-01-01'}
			};

			const response = await SELF.fetch('http://localhost/test/edges', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(edgeData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.from_node).toBe(nodeId1);
			expect(result.to_node).toBe(nodeId2);
			expect(result.relationship_type).toBe('follows');
			expect(result.properties.since).toBe('2024-01-01');
			expect(result.id).toBeDefined();
		});

		it('should list edges with filtering', async () => {
			// Create multiple edges
			await Promise.all([
				SELF.fetch('http://localhost/test/edges', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						from_node: nodeId1,
						to_node: nodeId2,
						relationship_type: 'follows'
					})
				}),
				SELF.fetch('http://localhost/test/edges', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						from_node: nodeId2,
						to_node: nodeId1,
						relationship_type: 'blocks'
					})
				})
			]);

			// Get all edges
			const allResponse = await SELF.fetch('http://localhost/test/edges', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(allResponse.status).toBe(200);
			const allEdges = await allResponse.json<any>();
			expect(allEdges.edges.length).toBeGreaterThanOrEqual(2);

			// Get edges by type
			const followsResponse = await SELF.fetch('http://localhost/test/edges?type=follows', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(followsResponse.status).toBe(200);
			const followsEdges = await followsResponse.json<any>();
			expect(followsEdges.edges.length).toBeGreaterThanOrEqual(1);
			followsEdges.edges.forEach((edge: any) => expect(edge.relationship_type).toBe('follows'));

			// Get edges by from_node
			const fromResponse = await SELF.fetch(`http://localhost/test/edges?from=${nodeId1}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(fromResponse.status).toBe(200);
			const fromEdges = await fromResponse.json<any>();
			expect(fromEdges.edges.length).toBeGreaterThanOrEqual(1);
			fromEdges.edges.forEach((edge: any) => expect(edge.from_node).toBe(nodeId1));
		});
	});
});
