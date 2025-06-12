from dotenv import load_dotenv

load_dotenv()
import os
import time
import asyncio
import httpx
import jwt
import random
import statistics
import datetime
from collections import defaultdict
from report_utils import (
    generate_html_report,
    calculate_latency_percentiles,
    generate_latency_report,
)

# === Config ===
TOTAL_NODES = 100
TOTAL_EDGES = 200
CONCURRENT_REQUESTS = int(os.getenv("CF_CONCURRENT_REQUESTS", 10))
WORKER_URL = os.getenv("CF_WORKER_URL", "http://localhost")
OIDC_ISSUER = os.getenv("OIDC_DISCOVERY_URL")

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
setup_nodes = []

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
    {"path": "/load-test/nodes/node1", "method": "PUT", "body": {"type": "test", "properties": {"updated": True}}},
    {"path": "/load-test/nodes/node2", "method": "PUT", "body": {"type": "test", "properties": {"updated": True}}},
    {"path": "/load-test/edges", "method": "GET"},
    {"path": "/load-test/query", "method": "POST", "body": {"node_type": "test", "limit": 5}},
    {"path": "/load-test/traverse", "method": "POST",
     "body": {"start_node": "node1", "relationship_type": "CONNECTS_TO", "max_depth": 10}},
    {"path": "/load-test/traverse", "method": "POST",
     "body": {"start_node": "node2", "relationship_type": "DEPENDS_ON", "max_depth": 10}},
    {"path": "/load-test/metadata/export", "method": "GET"},
    {"path": "/load-test/metadata/import", "method": "POST", "body": {"nodes": [], "edges": []}},
]

# === Enhanced Metrics ===
metrics = {
    "total_time": 0,
    "success_count": 0,
    "failure_count": 0,
    "status_codes": defaultdict(int),
    "endpoints": defaultdict(lambda: {
        "count": 0,
        "total_time": 0,
        "min": float("inf"),
        "max": 0,
        "response_times": []
    }),
    "errors": [],
    "cleanup_stats": {"success": 0, "failure": 0},
    "latency_distribution": {
        "<50ms": 0,
        "50-100ms": 0,
        "100-250ms": 0,
        "250-500ms": 0,
        "500-1000ms": 0,
        ">1000ms": 0
    },
    "test_start_time": None,
    "test_end_time": None,
    "test_duration_seconds": 0,
    "operation_phase_times": {
        "setup": 0,
        "node_creation": 0,
        "edge_creation": 0,
        "other_operations": 0
    }
}

# === Create JWT Token ===
import requests

# Config

# Fetch OIDC discovery document
discovery = requests.get(OIDC_ISSUER).json()

# Extract token endpoint dynamically
KEYCLOAK_TOKEN_URL = discovery["token_endpoint"]
CLIENT_ID = os.getenv("OIDC_CLIENT_ID")
CLIENT_SECRET = os.getenv("OIDC_CLIENT_SECRET")
USERNAME = os.getenv("KEYCLOAK_TEST_USER")
PASSWORD = os.getenv("KEYCLOAK_TEST_PASS")

# Request token
response = requests.post(
    KEYCLOAK_TOKEN_URL,
    data={
        "grant_type": "password",
        "client_id": CLIENT_ID,
        "username": USERNAME,
        "password": PASSWORD,
        "scope": "openid",
    },
    headers={
        "Content-Type": "application/x-www-form-urlencoded"
    }
)

if response.status_code == 200:
    tokens = response.json()
    auth_token = tokens["id_token"]
    print("Access Token:\n", auth_token)
else:
    print("Error:", response.status_code, response.text)


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
        async with httpx.AsyncClient(timeout=30.0) as client:
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

            # Update endpoint-specific metrics
            ep = metrics["endpoints"][key]
            ep["count"] += 1
            ep["total_time"] += duration
            ep["min"] = min(ep["min"], duration)
            ep["max"] = max(ep["max"], duration)
            ep["response_times"].append(duration)

            # Update latency distribution
            if duration < 50:
                metrics["latency_distribution"]["<50ms"] += 1
            elif duration < 100:
                metrics["latency_distribution"]["50-100ms"] += 1
            elif duration < 250:
                metrics["latency_distribution"]["100-250ms"] += 1
            elif duration < 500:
                metrics["latency_distribution"]["250-500ms"] += 1
            elif duration < 1000:
                metrics["latency_distribution"]["500-1000ms"] += 1
            else:
                metrics["latency_distribution"][">1000ms"] += 1

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

            # Still record the latency for failed requests
            if duration < 50:
                metrics["latency_distribution"]["<50ms"] += 1
            elif duration < 100:
                metrics["latency_distribution"]["50-100ms"] += 1
            elif duration < 250:
                metrics["latency_distribution"]["100-250ms"] += 1
            elif duration < 500:
                metrics["latency_distribution"]["250-500ms"] += 1
            elif duration < 1000:
                metrics["latency_distribution"]["500-1000ms"] += 1
            else:
                metrics["latency_distribution"][">1000ms"] += 1
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
            if isinstance(result, Exception) or result is None or (
                    hasattr(result, 'status_code') and result.status_code >= 400):
                metrics["cleanup_stats"]["failure"] += 1
            else:
                metrics["cleanup_stats"]["success"] += 1

    print(
        f"Cleanup complete: {metrics['cleanup_stats']['success']} successful, {metrics['cleanup_stats']['failure']} failed")


# === Setup Environment ===
async def setup_environment():
    print("Setting up test environment...")
    setup_start = time.perf_counter()

    # First, clean up any existing data
    await clean_environment()

    setup_tasks = []

    # Create all setup nodes and edges in a batch
    for endpoint in setup_nodes:
        setup_tasks.append(make_request(endpoint))

    # Run all setup tasks together
    await asyncio.gather(*setup_tasks)

    setup_end = time.perf_counter()
    metrics["operation_phase_times"]["setup"] = (setup_end - setup_start) * 1000
    print(
        f"Environment setup complete with {len(setup_nodes)} requests in {metrics['operation_phase_times']['setup']:.2f}ms")


# === Run Load Test ===
async def run_load_test():
    metrics["test_start_time"] = datetime.datetime.now()
    test_start = time.perf_counter()
    print(f"Running load test on {WORKER_URL}")

    # Run environment setup first
    await setup_environment()

    # First, create all 100 nodes
    print(f"Phase 1: Creating {TOTAL_NODES} nodes...")
    node_phase_start = time.perf_counter()
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

    node_phase_end = time.perf_counter()
    metrics["operation_phase_times"]["node_creation"] = (node_phase_end - node_phase_start) * 1000

    # Reset tasks
    tasks = []

    # Then, create all 200 edges
    print(f"Phase 2: Creating {TOTAL_EDGES} edges...")
    edge_phase_start = time.perf_counter()

    for endpoint in edge_creation_endpoints:
        tasks.append(make_request(endpoint))

        # Run in batches of CONCURRENT_REQUESTS
        if len(tasks) >= CONCURRENT_REQUESTS:
            await asyncio.gather(*tasks)
            tasks = []

    # Run any remaining edge tasks
    if tasks:
        await asyncio.gather(*tasks)

    edge_phase_end = time.perf_counter()
    metrics["operation_phase_times"]["edge_creation"] = (edge_phase_end - edge_phase_start) * 1000

    # Reset tasks
    tasks = []

    # Finally, run other operations
    print("Phase 3: Running other operations...")
    other_phase_start = time.perf_counter()
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

    other_phase_end = time.perf_counter()
    metrics["operation_phase_times"]["other_operations"] = (other_phase_end - other_phase_start) * 1000

    # Record test end time
    test_end = time.perf_counter()
    metrics["test_end_time"] = datetime.datetime.now()
    metrics["test_duration_seconds"] = test_end - test_start

    # === Standard Report ===
    total_requests = metrics["success_count"] + metrics["failure_count"]
    print("\n=== Load Test Results ===")
    print(f"Total requests: {total_requests}")
    if total_requests > 0:
        print(
            f"Success rate: {metrics['success_count']}/{total_requests} ({metrics['success_count'] / total_requests * 100:.2f}%)")
        print(f"Avg response time: {metrics['total_time'] / total_requests:.2f}ms")
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
            print(f"    Avg time: {data['total_time'] / data['count']:.2f}ms")
            print(f"    Min time: {data['min']:.2f}ms")
            print(f"    Max time: {data['max']:.2f}ms")

    if metrics["errors"]:
        print("\nErrors:")
        for err in metrics["errors"][:5]:  # Show only first 5 errors
            print(f"  - {err}")
        if len(metrics["errors"]) > 5:
            print(f"  ... and {len(metrics['errors']) - 5} more errors")

    # === Enhanced Latency Report ===
    latency_report = generate_latency_report(metrics)
    print(latency_report)

    # Save text and HTML reports
    try:
        timestamp = metrics["test_end_time"].strftime("%Y%m%d_%H%M%S")
        text_filename = f"load_test_latency_{timestamp}.log"
        with open(text_filename, "w") as f:
            f.write(latency_report)
        print(f"\nLatency report saved to {text_filename}")

        percentiles = calculate_latency_percentiles(metrics)
        html_content = generate_html_report(metrics, percentiles)
        html_filename = f"load_test_latency_{timestamp}.html"
        with open(html_filename, "w") as f:
            f.write(html_content)
        print(f"HTML report saved to {html_filename}")
    except Exception as e:
        print(f"\nError saving latency report: {str(e)}")


# === Entry Point ===
if __name__ == "__main__":
    asyncio.run(run_load_test())
