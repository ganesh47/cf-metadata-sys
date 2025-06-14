// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {createJwt} from "./auth.spec";
import {Env} from "../src/types/graph";
import {initializeDatabase} from "../src/d1/initDb";

describe('/edge API GraphDB Worker Tests', async () => {
	const eenv:Env = env as Env
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
	// Your existing test suites...
	describe('Edge Operations', () => {
		let nodeId1: string;
		let nodeId2: string;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		let edgeId: string;

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
				properties: {
					since: '2024-01-01',
					description:"Long sentences form with the verbiage of things",
					para:"something else",
					object_test:{name:"something",description:"something something"},
					vectorize: ["description","para","object_test"]

				}
			};

			const response = await SELF.fetch('http://localhost/test/edge', {
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
			expect(result.org_id).toBe('test');
			expect(result.created_by).toBeDefined();
			expect(result.updated_by).toBeDefined();
			expect(result.created_at).toBeDefined();
			expect(result.updated_at).toBeDefined();

			// Store edge ID for later tests
			edgeId = result.id;
		});

		it('should get a specific edge by ID', async () => {
			// First create an edge
			const createResponse = await SELF.fetch('http://localhost/test/edge', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					from_node: nodeId1,
					to_node: nodeId2,
					relationship_type: 'knows',
					properties: {since: '2023-12-01'}
				})
			});

			const edge = await createResponse.json<any>();

			// Now get the edge by ID
			const getResponse = await SELF.fetch(`http://localhost/test/edge/${edge.id}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			expect(getResponse.status).toBe(200);
			const result = await getResponse.json<any>();

			expect(result.id).toBe(edge.id);
			expect(result.from_node).toBe(nodeId1);
			expect(result.to_node).toBe(nodeId2);
			expect(result.relationship_type).toBe('knows');
			expect(result.properties.since).toBe('2023-12-01');
			expect(result.org_id).toBe('test');
			expect((await SELF.fetch(`http://localhost/test/edge/sdsdsd`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			})).status).toBe(404)
		});

		it('should update an edge', async () => {
			// First create an edge
			const createResponse = await SELF.fetch('http://localhost/test/edge', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					from_node: nodeId1,
					to_node: nodeId2,
					relationship_type: 'follows',
					properties: {since: '2024-01-01'}
				})
			});

			const edge = await createResponse.json<any>();
			const initialUpdatedAt = edge.updated_at;

			// Update the edge
			const updateResponse = await SELF.fetch(`http://localhost/test/edge/${edge.id}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`,
				},
				body: JSON.stringify({
					relationship_type: 'follows_closely',
					properties: {
						since: '2024-01-01',
						intensity: 'high'
					}
				})
			});

			expect(updateResponse.status).toBe(200);
			const updatedEdge = await updateResponse.json<any>();

			// Verify updates
			expect(updatedEdge.id).toBe(edge.id);
			expect(updatedEdge.relationship_type).toBe('follows_closely');
			expect(updatedEdge.properties.intensity).toBe('high');
			expect(updatedEdge.properties.since).toBe('2024-01-01');
			expect(updatedEdge.updated_by).toBe('d200cf81-cba3-4721-b497-d555d5b4a77d');
			expect(updatedEdge.updated_at).not.toBe(initialUpdatedAt);
			expect(updatedEdge.created_at).toBe(edge.created_at);
			expect(updatedEdge.org_id).toBe('test');

			// Get the edge to verify persistence
			const getResponse = await SELF.fetch(`http://localhost/test/edge/${edge.id}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			const retrievedEdge = await getResponse.json<any>();
			expect(retrievedEdge.relationship_type).toBe('follows_closely');
			expect(retrievedEdge.properties.intensity).toBe('high');

			expect((await SELF.fetch(`http://localhost/test/edge/sdsds`, {
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${validToken}`,
					},
					body: JSON.stringify({
						relationship_type: 'follows_closely',
						properties: {
							since: '2024-01-01',
							intensity: 'high'
						}
					})
				})
			).status).toBe(404)
		})
		it('should delete an edge', async () => {
			// First create an edge
			const createResponse = await SELF.fetch('http://localhost/test/edge', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					from_node: nodeId1,
					to_node: nodeId2,
					relationship_type: 'mentions',
					properties: {context: 'conversation'}
				})
			});

			const edge = await createResponse.json<any>();

			// Delete the edge
			const deleteResponse = await SELF.fetch(`http://localhost/test/edge/${edge.id}`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			expect(deleteResponse.status).toBe(200);
			const result = await deleteResponse.json<any>();

			expect(result.success).toBe(true);
			expect(result.edgeId).toBe(edge.id);
			expect(result.orgId).toBe('test');

			// Try to get the deleted edge
			const getResponse = await SELF.fetch(`http://localhost/test/edge/${edge.id}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			expect(getResponse.status).toBe(404);
		});

		it('should not be accessing edge with another organization', async () => {
			// Create edge in test org
			const createResponse = await SELF.fetch('http://localhost/test/edge', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({
					from_node: nodeId1,
					to_node: nodeId2,
					relationship_type: 'follows',
					properties: {since: '2024-01-01'}
				})
			});

			const edge = await createResponse.json<any>();

			// Create token for different org
			const otherOrgToken = await createJwt(eenv);

			// Try to access the edge with the wrong org token
			const getResponse = await SELF.fetch(`http://localhost/load-test/edge/${edge.id}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${otherOrgToken}`
				}
			});

			expect(getResponse.status).toBe(404);
			const error = await getResponse.json<any>();
			expect(error.error).toContain('Edge not found');
		});

		it('should list edges with filtering', async () => {
			// Create multiple edges
			await Promise.all([
				SELF.fetch('http://localhost/test/edge', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({
						from_node: nodeId1,
						to_node: nodeId2,
						relationship_type: 'follows'
					})
				}),
				SELF.fetch('http://localhost/test/edge', {
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
			expect(allEdges.metadata.org_id).toBe('test');

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

			// Verify audit and org metadata in returned edges
			fromEdges.edges.forEach((edge: any) => {
				expect(edge.org_id).toBe('test');
				expect(edge.created_at).toBeDefined();
				expect(edge.updated_at).toBeDefined();
				expect(edge.created_by).toBeDefined();
				expect(edge.updated_by).toBeDefined();
			});

			const toResponse = await SELF.fetch(`http://localhost/test/edges?to=${nodeId2}`, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			const toEdges = await toResponse.json<any>();
			expect(toEdges.edges.length).toBeGreaterThanOrEqual(1);
			toEdges.edges.forEach((edge: any) => expect(edge.to_node).toBe(nodeId2));

			// Verify audit and org metadata in returned edges
			toEdges.edges.forEach((edge: any) => {
				expect(edge.org_id).toBe('test');
				expect(edge.created_at).toBeDefined();
				expect(edge.updated_at).toBeDefined();
				expect(edge.created_by).toBeDefined();
				expect(edge.updated_by).toBeDefined();
			});
		});
	});
});
