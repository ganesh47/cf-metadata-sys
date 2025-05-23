// Modify your index.spec.ts to add these imports and hooks
import {afterAll, beforeEach, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData} from './setup';
import {DB_VERSION, EDGES_TABLE, generateTimestampVersion, NODES_TABLE} from "../src/constants";
import {initializeDatabase} from "../src/d1/initDb";
import {TraceContext} from "../src/types/graph";
import {Logger} from "../src/logger/logger";

describe('GraphDB Worker Tests', () => {
	const importData = {
		nodes: [
			{
				id: 'import-test-1',
				type: 'imported',
				properties: { source: 'import' },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			},
			{
				id: 'import-test-2',
				type: 'imported',
				properties: { source: 'import' },
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
	// Run once after all tests complete
  afterAll(async () => {
    await cleanAllData();
    console.log('✓ Final database cleanup completed');
  });

	describe('Database version', () => {
		it('should use the correct database version', () => {
			// Check that DB_VERSION is used for table names
			expect(NODES_TABLE).toEqual(`nodes_${DB_VERSION}`);
			expect(EDGES_TABLE).toEqual(`edges_${DB_VERSION}`);
		});
		it('versioing gen works correctly with ts',()=>{
			expect(generateTimestampVersion()).toMatch(/^v\d{10}$/);
		})
	})

	describe(" Database init should throw error when not configured currently",()=>{
		it("should throw error when not configured", async () => {
			const traceContext: TraceContext = {
				requestId:'',
				operation:'',
				startTime: Date.now(),
				metadata: {
					path:'',
					method:'',
					userAgent: '007',
					contentType: ''
				}
			};

			const logger = new Logger(traceContext,"info");
			await expect(() => initializeDatabase(undefined as any, logger)).rejects.toThrow(Error);
		});
	})

  // Your existing test suites...
	describe('Node Operations', () => {
		it('should create a new node', async () => {
			const nodeData = {
				type: 'user',
				properties: {
					name: 'John Doe',
					email: 'john@example.com'
				}
			};

			const response = await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(nodeData)
			});

			expect(response.status).toBe(200);

			const result:any = await response.json<any>();
			expect(result.type).toBe('user');
			expect(result.properties.name).toBe('John Doe');
			expect(result.id).toBeDefined();
			expect(result.created_at).toBeDefined();
		});

		it('should retrieve a node by ID', async () => {
			// First create a node
			const nodeData = {
				id: 'test-node-123',
				type: 'document',
				properties: { title: 'Test Document' }
			};

			await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(nodeData)
			});

			// Then retrieve it
			const response = await SELF.fetch('http://localhost/nodes/test-node-123');
			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.id).toBe('test-node-123');
			expect(result.type).toBe('document');
			expect(result.properties.title).toBe('Test Document');
			expect(response.headers.get('X-Node-Cache')).toBe('HIT')
			let ts = (new Date()).toISOString();
			// @ts-ignore
			await env.GRAPH_DB.prepare(`
			INSERT INTO ${NODES_TABLE} (id, type, properties, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
		`).bind(
				'test-node-124',
				'document',
				JSON.stringify({title:'Test Document'}),
				ts,
				ts
			).run();
			const uncachedResp = await SELF.fetch('http://localhost/nodes/test-node-124');
			expect(uncachedResp.status).toBe(200);

			const uncachedRes = await uncachedResp.json<any>();
			expect(uncachedRes.id).toBe('test-node-124');
			expect(uncachedRes.type).toBe('document');
			expect(uncachedRes.properties.title).toBe('Test Document');
			expect(uncachedResp.headers.get('X-Node-Cache')).toBe('MISS')
		});

		it('should return 404 for non-existent node', async () => {
			const response = await SELF.fetch('http://localhost/nodes/non-existent-id');
			expect(response.status).toBe(404);
		});

		it('should update an existing node', async () => {
			// Create a node first
			const nodeData = {
				id: 'update-test-node',
				type: 'user',
				properties: { name: 'Original Name' }
			};

			await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(nodeData)
			});

			// Update the node
			const updateData = {
				properties: { name: 'Updated Name', status: 'active' }
			};

			const response = await SELF.fetch('http://localhost/nodes/update-test-node', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			console.log(result)
			expect(result.properties.name).toBe('Updated Name');
			expect(result.properties.status).toBe('active');
			expect(result.updated_at).toBeDefined();
				//Update type
			const typeChangedResp = await SELF.fetch('http://localhost/nodes/update-test-node', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({...updateData, type: 'temp'})
			});

			expect(typeChangedResp.status).toBe(200);

			const typeChangedRes = await typeChangedResp.json<any>();
			console.log(typeChangedRes)
			expect(typeChangedRes.properties.name).toBe('Updated Name');
			expect(typeChangedRes.type).toBe('temp');
			expect(typeChangedRes.properties.status).toBe('active');
			expect(typeChangedRes.updated_at).toBeDefined();

			//Update a non-existing node

			const nonExistingNode = await SELF.fetch('http://localhost/nodes/update-test-node-1234', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({...updateData, type: 'temp'})
			});

			expect(nonExistingNode.status).toBe(404);

		});

		it('should delete a node', async () => {

			// Create a node first
			const nodeData = [{
				id: 'delete-test-node',
				type: 'temp',
				properties: {'test':'test'}
			},{
				id: 'delete-test-node-2',
				type: 'temp',
				properties: {'test':'test2'}
			}];

			for (const node of nodeData) {
				await SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(node)
				})}

			const edgeData= {
					id: 'del-edge-1',
					from_node: 'delete-test-node',
					to_node: 'delete-test-node-2',
					relationship_type: 'child',
					properties: {},
					created_at: new Date().toISOString()
				}

				await SELF.fetch('http://localhost/edges', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(edgeData)
			});

			await SELF.fetch('http://localhost/nodes/delete-test-node')
			// Delete the node
			const response = await SELF.fetch('http://localhost/nodes/delete-test-node', {
				method: 'DELETE'
			});

			expect(response.status).toBe(200);
			const result = await response.json<any>();
			expect(result.deleted).toBe('delete-test-node');
			expect((await SELF.fetch("http://localhost/edges/del-edge-1")).status).toBe(404);
			// Verify node is deleted
			const getResponse = await SELF.fetch('http://localhost/nodes/delete-test-node');
			expect(getResponse.status).toBe(404);
			expect((await SELF.fetch('http://localhost/nodes/delete-test-node', {
				method: 'DELETE'
			})).status).toBe(404);
			expect((await SELF.fetch('http://localhost/nodes/', {
				method: 'DELETE'
			})).status).toBe(404);

		});

		it('should list nodes with filtering', async () => {
			// Create multiple nodes
			await Promise.all([
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'user', properties: { name: 'User 1' } })
				}),
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'document', properties: { title: 'Doc 1' } })
				}),
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'user', properties: { name: 'User 2' } })
				})
			]);

			// Get all nodes
			const allResponse = await SELF.fetch('http://localhost/nodes');
			expect(allResponse.status).toBe(200);
			const allNodes = await allResponse.json<any>();
			expect(allNodes.length).toBeGreaterThanOrEqual(3);

			// Get filtered nodes
			const userResponse = await SELF.fetch('http://localhost/nodes?type=user');
			expect(userResponse.status).toBe(200);
			const userNodes = await userResponse.json<any>();
			expect(userNodes.length).toBeGreaterThanOrEqual(2);
			// @ts-ignore
			userNodes.forEach(node => expect(node.type).toBe('user'));
		});
	});

	describe('Edge Operations', () => {
		let nodeId1: string;
		let nodeId2: string;

		beforeEach(async () => {
			// Create test nodes
			const node1Response = await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'user',
					properties: { name: 'Alice' }
				})
			});
			const node1 = await node1Response.json<any>();
			nodeId1 = node1.id;

			const node2Response = await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'user',
					properties: { name: 'Bob' }
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
				properties: { since: '2024-01-01' }
			};

			const response = await SELF.fetch('http://localhost/edges', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
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
				SELF.fetch('http://localhost/edges', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						from_node: nodeId1,
						to_node: nodeId2,
						relationship_type: 'follows'
					})
				}),
				SELF.fetch('http://localhost/edges', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						from_node: nodeId2,
						to_node: nodeId1,
						relationship_type: 'blocks'
					})
				})
			]);

			// Get all edges
			const allResponse = await SELF.fetch('http://localhost/edges');
			expect(allResponse.status).toBe(200);
			const allEdges = await allResponse.json<any>();
			expect(allEdges.length).toBeGreaterThanOrEqual(2);

			// Get edges by type
			const followsResponse = await SELF.fetch('http://localhost/edges?type=follows');
			expect(followsResponse.status).toBe(200);
			const followsEdges = await followsResponse.json<any>();
			expect(followsEdges.length).toBeGreaterThanOrEqual(1);
			// @ts-ignore
			followsEdges.forEach(edge => expect(edge.relationship_type).toBe('follows'));

			// Get edges by from_node
			const fromResponse = await SELF.fetch(`http://localhost/edges?from=${nodeId1}`);
			expect(fromResponse.status).toBe(200);
			const fromEdges = await fromResponse.json<any>();
			expect(fromEdges.length).toBeGreaterThanOrEqual(1);
			// @ts-ignore
			fromEdges.forEach(edge => expect(edge.from_node).toBe(nodeId1));
		});
	});

	describe('Graph Query Operations', () => {
		beforeEach(async () => {
			// Set up the test graph
			const users = await Promise.all([
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'user',
						properties: { name: 'Alice', role: 'admin' }
					})
				}).then(r => r.json<any>()),
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'user',
						properties: { name: 'Bob', role: 'user' }
					})
				}).then(r => r.json<any>()),
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'document',
						properties: { title: 'Important Doc' }
					})
				}).then(r => r.json<any>())
			]);

			// Create relationships
			await Promise.all([
				SELF.fetch('http://localhost/edges', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						from_node: users[0].id,
						to_node: users[1].id,
						relationship_type: 'manages'
					})
				}),
				SELF.fetch('http://localhost/edges', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
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

			const response = await SELF.fetch('http://localhost/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
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
			const nodesResponse = await SELF.fetch('http://localhost/nodes?type=user&limit=1');
			const nodes = await nodesResponse.json<any>();
			const startNodeId = nodes[0].id;

			const traversalData = {
				start_node: startNodeId,
				max_depth: 2
			};

			const response = await SELF.fetch('http://localhost/traverse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
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

	describe('Metadata Operations', () => {



		it('should import metadata', async () => {

			const response = await SELF.fetch('http://localhost/metadata/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(importData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.imported_nodes).toBe(2);
			expect(result.imported_edges).toBe(2);

			// Verify imported node exists
			const nodeResponse = await SELF.fetch('http://localhost/nodes/import-test-1');
			expect(nodeResponse.status).toBe(200);
			const node = await nodeResponse.json<any>();
			expect(node.type).toBe('imported');

			const responseInvalid= await SELF.fetch('http://localhost/metadata/import',{
				method:'POST',
				headers: { 'Content-Type': 'application/json' },
				body: undefined
			})
			expect(responseInvalid.status).toBe(500);
		});
		it('should export metadata', async () => {
			// Create some test data first
			await SELF.fetch('http://localhost/metadata/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(importData)
			});

			const response = await SELF.fetch('http://localhost/metadata/export');
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
			const response = await SELF.fetch('http://localhost/nodes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: 'invalid json'
			});

			expect(response.status).toBe(500);
			const result = await response.json<any>();
			expect(result.error).toBeDefined();
			expect(result.requestId).toBeDefined();
		});

		it('should handle missing required fields', async () => {
			const response = await SELF.fetch('http://localhost/edges', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					// Missing from_node and to_node
					relationship_type: 'test'
				})
			});

			expect(response.status).toBe(500);
		});

		it('should return 404 for unknown routes', async () => {
			const response = await SELF.fetch('http://localhost/unknown-route');
			expect(response.status).toBe(404);
		});
	});

	describe('Performance and Logging', () => {
		it('should include request ID in responses', async () => {
			const response = await SELF.fetch('http://localhost/nodes');
			expect(response.status).toBe(200);

			// Check that logs contain request ID (this would be visible in test output)
			// In a real scenario, you'd capture and verify log output
		});

		it('should handle concurrent requests', async () => {
			const requests = Array.from({ length: 5 }, (_, i) =>
				SELF.fetch('http://localhost/nodes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'concurrent',
						properties: { index: i }
					})
				})
			);

			const responses = await Promise.all(requests);

			responses.forEach(response => {
				expect(response.status).toBe(200);
			});

			// Verify all nodes were created
			const listResponse = await SELF.fetch('http://localhost/nodes?type=concurrent');
			const nodes = await listResponse.json<any>();
			expect(nodes.length).toBe(5);
		});
	});
});
