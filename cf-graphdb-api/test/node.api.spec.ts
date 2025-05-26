// Modify your ops.spec.ts to add these imports and hooks
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {env, SELF} from 'cloudflare:test';
import {cleanAllData, prepareLogger} from './setup';
import {NODES_TABLE} from "../src/constants";
import {createJwt} from "./auth.spec";
import {initializeDatabase} from "../src/d1/initDb";

describe('/node API GraphDB  Worker Tests', async () => {
	const eenv = env as any
	const validToken = await createJwt(eenv,"test:*");
	const {initStart, logger} = prepareLogger();

	// Your existing test suites...
	describe('Node Operations', () => {

		beforeAll(async ()=>{
			console.log("Starting Init")
			await initializeDatabase(eenv.GRAPH_DB, logger);
			logger.performance('database_init', Date.now() - initStart);
		})
		// Run once after all tests complete

		afterAll(async () => {
			await cleanAllData();
			console.log('✓ Final database cleanup completed');
		});

		it('should create a new node', async () => {
			const nodeData = {
				type: 'user',
				properties: {
					name: 'John Doe',
					email: 'john@example.com'
				}
			};

			const response = await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(nodeData)
			});

			expect(response.status).toBe(200);

			const result: any = await response.json<any>();
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
				properties: {title: 'Test Document'}
			};

			await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(nodeData)
			});

			// Then retrieve it
			const response = await SELF.fetch('http://localhost/test/nodes/test-node-123', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(response.status).toBe(200);

			const result = await response.json<any>();
			expect(result.id).toBe('test-node-123');
			expect(result.type).toBe('document');
			expect(result.properties.title).toBe('Test Document');
			expect(response.headers.get('X-Node-Cache')).toBe('HIT')
			const ts = (new Date()).toISOString();
			const eenv = env as any
			await eenv.GRAPH_DB.prepare(`
				INSERT INTO ${NODES_TABLE} (
					id, org_id, type, properties, created_at, updated_at,
					created_by, updated_by, user_agent, client_ip
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				'test-node-124',
				'test',
				'document',
				JSON.stringify({title: 'Test Document'}),
				ts,
				ts,
				'1234',
				'1234',
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36',
				'127.0.0.1'
			).run();
			const uncachedResp = await SELF.fetch('http://localhost/test/nodes/test-node-124', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(uncachedResp.status).toBe(200);

			const uncachedRes = await uncachedResp.json<any>();
			expect(uncachedRes.id).toBe('test-node-124');
			expect(uncachedRes.type).toBe('document');
			expect(uncachedRes.properties.title).toBe('Test Document');
			expect(uncachedResp.headers.get('X-Node-Cache')).toBe('MISS')
		});

		it('should return 404 for non-existent node', async () => {
			const response = await SELF.fetch('http://localhost/test/nodes/non-existent-id', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(response.status).toBe(404);
		});

		it('should update an existing node', async () => {
			// Create a node first
			const nodeData = {
				id: 'update-test-node',
				type: 'user',
				properties: {name: 'Original Name'}
			};

			await SELF.fetch('http://localhost/test/nodes', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(nodeData)
			});

			// Update the node
			const updateData = {
				properties: {name: 'Updated Name', status: 'active'}
			};

			const response = await SELF.fetch('http://localhost/test/nodes/update-test-node', {
				method: 'PUT',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(updateData)
			});

			expect(response.status).toBe(200);

			const result = await response.json<any>();
			console.log(result)
			expect(result.properties.name).toBe('Updated Name');
			expect(result.properties.status).toBe('active');
			expect(result.updated_at).toBeDefined();
			//Update type
			const typeChangedResp = await SELF.fetch('http://localhost/test/nodes/update-test-node', {
				method: 'PUT',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
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

			const nonExistingNode = await SELF.fetch('http://localhost/test/nodes/update-test-node-1234', {
				method: 'PUT',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify({...updateData, type: 'temp'})
			});

			expect(nonExistingNode.status).toBe(404);

		});

		it('should delete a node', async () => {

			// Create a node first
			const nodeData = [{
				id: 'delete-test-node',
				type: 'temp',
				properties: {'test': 'test'}
			}, {
				id: 'delete-test-node-2',
				type: 'temp',
				properties: {'test': 'test2'}
			}];

			for (const node of nodeData) {
				await SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify(node)
				})
			}

			const edgeData = {
				id: 'del-edge-1',
				from_node: 'delete-test-node',
				to_node: 'delete-test-node-2',
				relationship_type: 'child',
				properties: {},
				created_at: new Date().toISOString()
			}

			await SELF.fetch('http://localhost/test/edges', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
				body: JSON.stringify(edgeData)
			});

			await SELF.fetch('http://localhost/test/nodes/delete-test-node', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			})
			// Delete the node
			const response = await SELF.fetch('http://localhost/test/nodes/delete-test-node', {
				method: 'DELETE', headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});

			expect(response.status).toBe(200);
			const result = await response.json<any>();
			expect(result.deleted).toBe('delete-test-node');
			expect((await SELF.fetch("http://localhost/test/edges/del-edge-1", {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			})).status).toBe(404);
			// Verify node is deleted
			const getResponse = await SELF.fetch('http://localhost/test/nodes/delete-test-node', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(getResponse.status).toBe(404);
			expect((await SELF.fetch('http://localhost/test/nodes/delete-test-node', {
				method: 'DELETE', headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			})).status).toBe(404);
			expect((await SELF.fetch('http://localhost/test/nodes/', {
				method: 'DELETE', headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`}
			})).status).toBe(404);

		});

		it('should list nodes with filtering', async () => {
			// Create multiple nodes
			await Promise.all([
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({type: 'user', properties: {name: 'User 1'}})
				}),
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({type: 'document', properties: {title: 'Doc 1'}})
				}),
				SELF.fetch('http://localhost/test/nodes', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${validToken}`},
					body: JSON.stringify({type: 'user', properties: {name: 'User 2'}})
				})
			]);

			// Get all nodes
			const allResponse = await SELF.fetch('http://localhost/test/nodes', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(allResponse.status).toBe(200);
			const allNodes = await allResponse.json<any>();
			expect(allNodes.data.length).toBeGreaterThanOrEqual(3);

			// Get filtered nodes
			const userResponse = await SELF.fetch('http://localhost/test/nodes?type=user', {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${validToken}`
				}
			});
			expect(userResponse.status).toBe(200);
			const userNodes = await userResponse.json<any>();
			expect(userNodes.data.length).toBeGreaterThanOrEqual(2);
			userNodes.data.forEach((node: any) => expect(node.type).toBe('user'));
		});
	});
});
