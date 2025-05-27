from dotenv import load_dotenv
import os
import time
import asyncio
import httpx
import jwt
import pandas as pd
import ast
from tqdm.asyncio import tqdm_asyncio

# === Load Env ===
load_dotenv()

WORKER_URL = os.getenv("CF_WORKER_URL", "http://localhost")
JWT_SECRET = os.getenv("ENV_JWT_SECRET", "test-secret")
CONCURRENT_REQUESTS = int(os.getenv("CF_CONCURRENT_REQUESTS", 10))
INPUT_FILE = os.getenv("YOUTUBE_FLAT_CSV", "youtube8m_flat.csv.gz")

# === Generate JWT ===
auth_token = jwt.encode(
    {
        "sub": "youtube-ingestor",
        "email": "analyst@youtube.com",
        "permissions": "youtube:write",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600*4,
    },
    JWT_SECRET,
    algorithm="HS256"
)

# === Read CSV ===
df = pd.read_csv(INPUT_FILE, compression='gzip')
df['youtube_id'] = df['youtube_id'].astype(str)
df = df[df['youtube_id'] != 'nan']

# === Build DELETE and POST requests
video_node_requests = []

for _, row in df.iterrows():
    video_id = row["id"]
    youtube_url = row.get("youtube_url", None)
    node_id = f"video:{video_id}"

    # POST request
    node = {
        "path": "/youtube/nodes",
        "method": "POST",
        "body": {
            "id": node_id,
            "type": "youtube_video",
            "properties": {
                "youtube_id": video_id,
                "youtube_url": youtube_url
            }
        }
    }

    try:
        parsed_labels = ast.literal_eval(row["labels"]) if pd.notna(row["labels"]) else []
        if isinstance(parsed_labels, list):
            node["body"]["properties"]["labels"] = parsed_labels
    except Exception as e:
        print(f"⚠️ Failed to parse labels for video ID {video_id}: {e}")

    video_node_requests.append(node)
# === Build label edges
label_edge_requests = []

for _, row in df.iterrows():
    video_id = row["id"]
    youtube_url = row.get("youtube_url", None)
    from_node = f"video:{video_id}"

    try:
        parsed_labels = ast.literal_eval(row["labels"]) if pd.notna(row["labels"]) else []
        for label_id in parsed_labels:
            to_node = str(label_id)  # assuming vocabulary node ID is label index as a string
            label_edge_requests.append({
                "path": "/youtube/edge",
                "method": "POST",
                "body": {
                    "from_node": from_node,
                    "to_node": to_node,
                    "relationship_type": "label",
                    "properties": {
                        "youtube_url": youtube_url,
                        "inference": "static"
                    }
                }
            })
    except Exception as e:
        print(f"⚠️ Failed to create label edges for video ID {video_id}: {e}")

# === Metrics ===
metrics = {
    "success": 0,
    "fail": 0,
    "latencies": []
}

# === HTTP async request logic
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

# === Async batch processor with progress
async def process_requests(endpoints, label):
    from httpx import Limits
    limits = Limits(max_connections=CONCURRENT_REQUESTS * 2, max_keepalive_connections=CONCURRENT_REQUESTS)

    async with httpx.AsyncClient(timeout=60.0, limits=limits) as client:
        batches = [endpoints[i:i + CONCURRENT_REQUESTS] for i in range(0, len(endpoints), CONCURRENT_REQUESTS)]
        for batch in tqdm_asyncio(batches, desc=label, unit="batch"):
            await asyncio.gather(*[make_request(client, ep) for ep in batch])


# === Main runner
async def main():
    start_time = time.time()

    print(f"📹 Ingesting {len(video_node_requests)} video nodes...")
    await process_requests(video_node_requests, "📹 Ingesting")

    print(f"🔗 Creating {len(label_edge_requests)} label edges...")
    await process_requests(label_edge_requests, "🔗 Ingesting Label Edges")

    end_time = time.time()
    total_duration = end_time - start_time

    print("\n✅ Ingestion complete.")
    total = metrics["success"] + metrics["fail"]

    print("\n📊 Metrics:")
    print(f"  - Total: {total}")
    print(f"  - Success: {metrics['success']}")
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
