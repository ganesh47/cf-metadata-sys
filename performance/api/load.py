from dotenv import load_dotenv
load_dotenv()
import os
import time
import asyncio
import httpx
import jwt
import random
from collections import defaultdict

# === Config ===
TOTAL_NODES = 100
TOTAL_EDGES = 200
CONCURRENT_REQUESTS = 10
WORKER_URL = os.getenv("CF_WORKER_URL", "http://localhost")
JWT_SECRET = os.getenv("ENV_JWT_SECRET", "test-secret")

# === Pre-Test Cleanup Requests ===
# First delete all edges (must be done before deleting nodes)
cleanup_edges_request = {"path": "/load-test/edges", "method": "GET"}

# Then delete all nodes numbered 1-100
cleanup_nodes = []
for i in range(1, TOTAL_NODES + 1):
    cleanup_nodes.append({
        "path": f"/load-test/nodes/node{i}", 
        "method": "DELETE"
    })

# === Pre-Test Setup Nodes ===
setup_nodes = [
    {"path": "/load-test/nodes", "method": "POST", "body": {"id":"123","type": "setup", "properties": {"name": "Setup Node 1", "purpose": "pre-test"}}},
    {"path": "/load-test/nodes", "method": "POST", "body": {"id":"456","type": "setup", "properties": {"name": "Setup Node 2", "purpose": "pre-test"}}},
    {"path": "/load-test/edge", "method": "POST", "body": {"from_node": "123", "to_node": "456", "relationship_type": "SETUP_RELATION", "properties": {"created": "pre-test"}}}
]

# === Generate Node Creation Endpoints ===
node_creation_endpoints = []
for i in range(1, TOTAL_NODES + 1):
    node_creation_endpoints.append({
        "path": "/load-test/nodes", 
        "method": "POST", 
        "body": {
            "id": f"node{i}",
            "type": "test", 
            "properties": {
                "name": f"Load Test Node {i}",
                "number": i,
                "created_at": time.time()
            }
        }
    })

# === Relationship Types ===
relationship_types = [
    "CONNECTS_TO", 
    "DEPENDS_ON", 
    "REFERENCES", 
    "LINKS_TO", 
    "PARENT_OF"
]

# === Generate Edge Creation Endpoints ===
edge_creation_endpoints = []
for i in range(TOTAL_EDGES):
    # Generate random source and target nodes
    from_node = f"node{random.randint(1, TOTAL_NODES)}"
    to_node = f"node{random.randint(1, TOTAL_NODES)}"
    
    # Ensure from_node != to_node
    while from_node == to_node:
        to_node = f"node{random.randint(1, TOTAL_NODES)}"
    
    edge_creation_endpoints.append({
        "path": "/load-test/edge",
        "method": "POST",
        "body": {
            "from_node": from_node,
            "to_node": to_node,
            "relationship_type": random.choice(relationship_types),
            "properties": {
                "weight": random.randint(1, 10),
                "created_at": time.time()
            }
        }
    })

# === Other Operations ===
other_endpoints = [
    {"path": "/load-test/nodes", "method": "GET"},
    {"path": "/load-test/nodes/node1", "method": "GET"},
    {"path": "/load-test/nodes/node2", "method": "GET"},
    {"path": "/load-test/nodes/node3", "method": "GET"},
    {"path": "/load-test/nodes/node1", "method": "PUT", "body": {"type":"test","properties": {"updated": True}}},
    {"path": "/load-test/nodes/node2", "method": "PUT", "body": {"type":"test","properties": {"updated": True}}},
    {"path": "/load-test/edges", "method": "GET"},
    {"path": "/load-test/query", "method": "POST", "body": {"node_type": "test", "limit": 5}},
    {"path": "/load-test/traverse", "method": "POST", "body": {"start_node": "node1", "relationship_type": "CONNECTS_TO", "max_depth": 2}},
    {"path": "/load-test/traverse", "method": "POST", "body": {"start_node": "node2", "relationship_type": "DEPENDS_ON", "max_depth": 2}},
    {"path": "/load-test/metadata/export", "method": "GET"},
    {"path": "/load-test/metadata/import", "method": "POST", "body": {"nodes": [], "edges": []}},
]

# === Metrics ===
metrics = {
    "total_time": 0,
    "success_count": 0,
    "failure_count": 0,
    "status_codes": defaultdict(int),
    "endpoints": defaultdict(lambda: {"count": 0, "total_time": 0, "min": float("inf"), "max": 0}),
    "errors": [],
    "cleanup_stats": {"success": 0, "failure": 0}
}

# === Create JWT Token ===
auth_token = jwt.encode(
    {
        "sub": "load-test-user",
        "email": "loadtest@example.com",
        "permissions": "load-test:write",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    },
    JWT_SECRET,
    algorithm="HS256"
)

# === Load Test Logic ===
async def make_request(endpoint, count_in_metrics=True):
    key = f"{endpoint['method']} {endpoint['path']}"
    url = WORKER_URL + endpoint["path"]
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    start_time = time.perf_counter()

    try:
        async with httpx.AsyncClient() as client:
            if endpoint["method"] == "GET":
                res = await client.get(url, headers=headers)
            elif endpoint["method"] == "POST":
                res = await client.post(url, headers=headers, json=endpoint["body"])
            elif endpoint["method"] == "PUT":
                res = await client.put(url, headers=headers, json=endpoint["body"])
            elif endpoint["method"] == "DELETE":
                res = await client.delete(url, headers=headers)
            else:
                raise ValueError("Unsupported method")
        
        duration = (time.perf_counter() - start_time) * 1000
        
        if count_in_metrics:
            metrics["total_time"] += duration
            metrics["status_codes"][res.status_code] += 1

            ep = metrics["endpoints"][key]
            ep["count"] += 1
            ep["total_time"] += duration
            ep["min"] = min(ep["min"], duration)
            ep["max"] = max(ep["max"], duration)

            if res.status_code >= 200 and res.status_code < 400:
                metrics["success_count"] += 1
            else:
                metrics["failure_count"] += 1
                metrics["errors"].append(f"{key} → {res.status_code}: {res.text[:100]}")
        
        return res

    except Exception as e:
        duration = (time.perf_counter() - start_time) * 1000
        if count_in_metrics:
            metrics["total_time"] += duration
            metrics["failure_count"] += 1
            metrics["errors"].append(f"{key} failed: {str(e)}")
        return None

# === Clean Environment ===
async def clean_environment():
    print("Cleaning previous test data...")
    
    # First get all edges
    try:
        res = await make_request(cleanup_edges_request, count_in_metrics=False)
        if res and res.status_code == 200:
            edges = res.json()
            print(f"Found {len(edges)} edges to delete")
            
            # Delete all edges
            delete_tasks = []
            for edge in edges:
                if "id" in edge:
                    delete_request = {
                        "path": f"/load-test/edge/{edge['id']}", 
                        "method": "DELETE"
                    }
                    delete_tasks.append(make_request(delete_request, count_in_metrics=False))
            
            # Process edge deletion in batches
            for i in range(0, len(delete_tasks), CONCURRENT_REQUESTS):
                batch = delete_tasks[i:i + CONCURRENT_REQUESTS]
                results = await asyncio.gather(*batch, return_exceptions=True)
                
                for result in results:
                    if isinstance(result, Exception) or result is None or result.status_code >= 400:
                        metrics["cleanup_stats"]["failure"] += 1
                    else:
                        metrics["cleanup_stats"]["success"] += 1
    except Exception as e:
        print(f"Error getting edges: {str(e)}")
    
    # Then delete all nodes
    delete_tasks = []
    for endpoint in cleanup_nodes:
        delete_tasks.append(make_request(endpoint, count_in_metrics=False))
    
    # Process node deletion in batches
    for i in range(0, len(delete_tasks), CONCURRENT_REQUESTS):
        batch = delete_tasks[i:i + CONCURRENT_REQUESTS]
        results = await asyncio.gather(*batch, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception) or result is None or (hasattr(result, 'status_code') and result.status_code >= 400):
                metrics["cleanup_stats"]["failure"] += 1
            else:
                metrics["cleanup_stats"]["success"] += 1
    
    print(f"Cleanup complete: {metrics['cleanup_stats']['success']} successful, {metrics['cleanup_stats']['failure']} failed")

# === Setup Environment ===
async def setup_environment():
    print("Setting up test environment...")
    
    # First, clean up any existing data
    await clean_environment()
    
    setup_tasks = []
    
    # Create all setup nodes and edges in a batch
    for endpoint in setup_nodes:
        setup_tasks.append(make_request(endpoint))
    
    # Run all setup tasks together
    await asyncio.gather(*setup_tasks)
    
    print(f"Environment setup complete with {len(setup_nodes)} requests")

# === Run Load Test ===
async def run_load_test():
    print(f"Running load test on {WORKER_URL}")
    
    # Run environment setup first
    await setup_environment()

    # First, create all 100 nodes
    print(f"Phase 1: Creating {TOTAL_NODES} nodes...")
    tasks = []
    
    for endpoint in node_creation_endpoints:
        tasks.append(make_request(endpoint))
        
        # Run in batches of CONCURRENT_REQUESTS
        if len(tasks) >= CONCURRENT_REQUESTS:
            await asyncio.gather(*tasks)
            tasks = []
    
    # Run any remaining node tasks
    if tasks:
        await asyncio.gather(*tasks)
    
    # Reset tasks
    tasks = []
    
    # Then, create all 200 edges
    print(f"Phase 2: Creating {TOTAL_EDGES} edges...")
    
    for endpoint in edge_creation_endpoints:
        tasks.append(make_request(endpoint))
        
        # Run in batches of CONCURRENT_REQUESTS
        if len(tasks) >= CONCURRENT_REQUESTS:
            await asyncio.gather(*tasks)
            tasks = []
    
    # Run any remaining edge tasks
    if tasks:
        await asyncio.gather(*tasks)
    
    # Reset tasks
    tasks = []
    
    # Finally, run other operations
    print("Phase 3: Running other operations...")
    other_count = 50  # Number of other operations to run
    
    for i in range(other_count):
        endpoint = other_endpoints[i % len(other_endpoints)]
        tasks.append(make_request(endpoint))
        
        # Run in batches of CONCURRENT_REQUESTS
        if len(tasks) >= CONCURRENT_REQUESTS:
            await asyncio.gather(*tasks)
            tasks = []
    
    # Run any remaining other operation tasks
    if tasks:
        await asyncio.gather(*tasks)

    # === Report ===
    total_requests = metrics["success_count"] + metrics["failure_count"]
    print("\n=== Load Test Results ===")
    print(f"Total requests: {total_requests}")
    if total_requests > 0:
        print(f"Success rate: {metrics['success_count']}/{total_requests} ({metrics['success_count']/total_requests*100:.2f}%)")
        print(f"Avg response time: {metrics['total_time']/total_requests:.2f}ms")
    else:
        print("No requests recorded in metrics")

    print("\nStatus code distribution:")
    for code, count in metrics["status_codes"].items():
        print(f"  {code}: {count}")

    print("\nEndpoint performance:")
    for key, data in metrics["endpoints"].items():
        if data["count"] > 0:
            print(f"  {key}:")
            print(f"    Count: {data['count']}")
            print(f"    Avg time: {data['total_time']/data['count']:.2f}ms")
            print(f"    Min time: {data['min']:.2f}ms")
            print(f"    Max time: {data['max']:.2f}ms")

    if metrics["errors"]:
        print("\nErrors:")
        for err in metrics["errors"]:
            print(f"  - {err}")

# === Entry Point ===
if __name__ == "__main__":
    asyncio.run(run_load_test())
