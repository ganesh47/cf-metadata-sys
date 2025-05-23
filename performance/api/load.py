from dotenv import load_dotenv
load_dotenv()
import os
import time
import asyncio
import httpx
import jwt
from collections import defaultdict

# === Config ===
TOTAL_REQUESTS = 100
CONCURRENT_REQUESTS = 10
WORKER_URL = os.getenv("CF_WORKER_URL", "http://localhost")
JWT_SECRET = os.getenv("ENV_JWT_SECRET", "test-secret")

# === Test Endpoints ===
endpoints = [
    {"path": "/nodes", "method": "GET"},
    {"path": "/nodes", "method": "POST", "body": {"type": "test", "properties": {"name": "Load Test Node"}}},
    {"path": "/nodes/123", "method": "GET"},
    {"path": "/nodes/123", "method": "PUT", "body": {"properties": {"updated": True}}},
    {"path": "/edges", "method": "GET"},
    {"path": "/edges", "method": "POST", "body": {"sourceId": "123", "targetId": "456", "type": "TEST_RELATION"}},
    {"path": "/query", "method": "POST", "body": {"nodeType": "test", "limit": 5}},
    {"path": "/traverse", "method": "POST", "body": {"startNodeId": "123", "relationshipType": "TEST_RELATION", "maxDepth": 2}},
    {"path": "/metadata/export", "method": "GET"},
    {"path": "/metadata/import", "method": "POST", "body": {"nodes": [], "edges": []}},
]

# === Metrics ===
metrics = {
    "total_time": 0,
    "success_count": 0,
    "failure_count": 0,
    "status_codes": defaultdict(int),
    "endpoints": defaultdict(lambda: {"count": 0, "total_time": 0, "min": float("inf"), "max": 0}),
    "errors": [],
}

# === Create JWT Token ===
auth_token = jwt.encode(
    {
        "sub": "load-test-user",
        "email": "loadtest@example.com",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    },
    JWT_SECRET,
    algorithm="HS256"
)

# === Load Test Logic ===
async def make_request(endpoint):
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

    except Exception as e:
        duration = (time.perf_counter() - start_time) * 1000
        metrics["total_time"] += duration
        metrics["failure_count"] += 1
        metrics["errors"].append(f"{key} failed: {str(e)}")

# === Run Load Test ===
async def run_load_test():
    print(f"Running load test on {WORKER_URL}")

    tasks = []
    for i in range(TOTAL_REQUESTS):
        endpoint = endpoints[i % len(endpoints)]
        tasks.append(make_request(endpoint))

    # Run in chunks
    for i in range(0, len(tasks), CONCURRENT_REQUESTS):
        batch = tasks[i:i + CONCURRENT_REQUESTS]
        await asyncio.gather(*batch)

    # === Report ===
    print("\n=== Load Test Results ===")
    print(f"Total requests: {TOTAL_REQUESTS}")
    print(f"Success rate: {metrics['success_count']}/{TOTAL_REQUESTS} ({metrics['success_count']/TOTAL_REQUESTS*100:.2f}%)")
    print(f"Avg response time: {metrics['total_time']/TOTAL_REQUESTS:.2f}ms")

    print("\nStatus code distribution:")
    for code, count in metrics["status_codes"].items():
        print(f"  {code}: {count}")

    print("\nEndpoint performance:")
    for key, data in metrics["endpoints"].items():
        print(f"  {key}:")
        print(f"    Count: {data['count']}")
        print(f"    Avg time: {data['total_time']/data['count']:.2f}ms")
        print(f"    Min time: {data['min']:.2f}ms")
        print(f"    Max time: {data['max']:.2f}ms")

    if metrics["errors"]:
        print("\nErrors:")
        for err in metrics["errors"][:10]:
            print(f"  - {err}")
        if len(metrics["errors"]) > 10:
            print(f"  ...and {len(metrics['errors']) - 10} more")

# === Entry Point ===
if __name__ == "__main__":
    asyncio.run(run_load_test())
