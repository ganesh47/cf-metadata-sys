from dotenv import load_dotenv
import os
import time
import asyncio
import httpx
import jwt
import pandas as pd
from tqdm.asyncio import tqdm_asyncio

# === Load Env ===
load_dotenv()

WORKER_URL = os.getenv("CF_WORKER_URL", "http://localhost")
JWT_SECRET = os.getenv("ENV_JWT_SECRET", "test-secret")
CONCURRENT_REQUESTS = int(os.getenv("CF_CONCURRENT_REQUESTS", 10))
VOCABULARY_FILE = os.getenv("VOCABULARY_FILE", "vocabulary.csv.gz")

# === Generate JWT ===
auth_token = jwt.encode(
    {
        "sub": "youtube-user",
        "email": "analyst@youtube.com",
        "permissions": "youtube:write",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    },
    JWT_SECRET,
    algorithm="HS256"
)

# === Read Vocabulary File ===
vocab_df = pd.read_csv(VOCABULARY_FILE, compression='gzip')
vocab_subset = vocab_df  # All rows


# === Build POST requests for ingestion
vocab_node_requests = []
for i, row in vocab_subset.iterrows():
    node = {
        "path": "/youtube/nodes",
        "method": "POST",
        "body": {
            "id": str(row["Index"]),
            "type": "vocabulary",
            "properties": {
                "index": str(row["Index"]),
                "number": i
            }
        }
    }
    for col in vocab_df.columns:
        if col != "Index":
            node["body"]["properties"][col.lower()] = row[col] if pd.notna(row[col]) else None

    vocab_node_requests.append(node)

# === Metrics ===
metrics = {
    "success": 0,
    "fail": 0,
    "latencies": []
}

# === Generic request executor
async def make_request(session, endpoint):
    url = WORKER_URL + endpoint["path"]
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    start = time.perf_counter()
    try:
        if endpoint["method"] == "DELETE":
            res = await session.delete(url, headers=headers)
        else:
            res = await session.post(url, headers=headers, json=endpoint["body"])
        elapsed = (time.perf_counter() - start) * 1000
        metrics["latencies"].append(elapsed)

        if 200 <= res.status_code < 300 or (endpoint["method"] == "DELETE" and res.status_code == 404):
            metrics["success"] += 1
        else:
            metrics["fail"] += 1
            print(f"❌ {endpoint.get('body', {}).get('id', endpoint['path'])} → {res.status_code}: {res.text[:100]}")
        return res.status_code
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        metrics["fail"] += 1
        metrics["latencies"].append(elapsed)
        print(f"❌ Request failed: {endpoint.get('path')} — {e}")
        return None

# === Async batch runner with tqdm
async def process_requests(endpoints, label="Processing"):
    limits = httpx.Limits(max_connections=CONCURRENT_REQUESTS * 2, max_keepalive_connections=CONCURRENT_REQUESTS)
    async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:
        batches = [endpoints[i:i + CONCURRENT_REQUESTS] for i in range(0, len(endpoints), CONCURRENT_REQUESTS)]
        for batch in tqdm_asyncio(batches, desc=label, unit="batch"):
            await asyncio.gather(*[make_request(client, ep) for ep in batch])

# === Main runner
async def main():
    start_time = time.time()
    print(f"🚀 Ingesting {len(vocab_node_requests)} vocabulary nodes...")

    await process_requests(vocab_node_requests, label="Ingesting")

    end_time = time.time()
    total_duration = end_time - start_time

    print("\n✅ Ingestion complete.")
    total = metrics["success"] + metrics["fail"]

    print("\n📊 Ingestion Metrics:")
    print(f"  - Total requests: {total}")
    print(f"  - Successful: {metrics['success']}")
    print(f"  - Failed: {metrics['fail']}")

    if metrics["latencies"]:
        print(f"  - Avg latency: {sum(metrics['latencies']) / len(metrics['latencies']):.2f} ms")
        print(f"  - Min latency: {min(metrics['latencies']):.2f} ms")
        print(f"  - Max latency: {max(metrics['latencies']):.2f} ms")

    print("\n🕒 Timing:")
    print(f"  - Start time: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(start_time))}")
    print(f"  - End time:   {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(end_time))}")
    print(f"  - Duration:   {total_duration:.2f} seconds ({total_duration / 60:.2f} minutes)")

# === Entry
if __name__ == "__main__":
    asyncio.run(main())
