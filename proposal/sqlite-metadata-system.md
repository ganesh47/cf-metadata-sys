# Proposal: Cloud-Agnostic Metadata Graph Platform on SQLite

## 1. Executive Summary
- **Objective**: Reimagine the current Cloudflare-centric metadata system as a portable, open-source platform that runs on any infrastructure (VM, container, desktop) with SQLite as the primary storage engine.
- **Motivation**: Preserve the strengths of the existing implementation—graph-first modeling, audit trails, RAG readiness—while eliminating the dependency on Cloudflare Workers/KV/R2, and unlocking offline, edge, or self-hosted deployments.
- **Outcome**: Deliver a drop-in replacement API, web console, and tooling stack that teams can self-host, embed into products, or extend with custom plugins.

## 2. Key Learnings from the Current System
| Observation | Impact on New Design |
|-------------|----------------------|
| Worker-based API is cost-efficient but tightly coupled to Cloudflare bindings (KV, D1, R2, Qdrant). | Storage, caching, and vector search must be reimagined with open-source equivalents and clean abstractions. |
| Request-level telemetry and auth guard patterns proved effective. | Preserve middleware structure with adapters for popular frameworks (Express, Fastify, gRPC, etc.). |
| Embedding workflow (Together AI → Qdrant) is powerful but optional. | Provide pluggable embedding + vector search layer; default to local-sqlite FTS, allow remote vector stores via config. |
| CI pipeline integrates performance load tests and schema enforcement. | Reuse automated testing approach; integrate SQLite migrations, seed data, smoke tests. |
| Front-end expects API shapes (`{ data, pagination }`) and OIDC-backed session cookies. | Keep API contracts stable; add config to run with local identity providers or API keys. |

## 3. Vision & Design Principles
1. **Cloud-Agnostic** – Run on laptops, private data centers, or cloud VMs using standard runtimes (Node.js, Bun, Deno, Go, Rust).
2. **SQLite-Centric** – Use SQLite (with JSON1, FTS5, and R*Tree extensions where available) for nodes, edges, embeddings, and audit logs.
3. **Pluggable & Modular** – Clear boundaries between storage, auth, API, and analytics. Swap components without rewriting core logic.
4. **Graph-native Semantics** – Preserve directed edges, properties, and traversal semantics honed in the Cloudflare version.
5. **Developer-Friendly** – Single binary or Docker image with sensible defaults; optional dev server featuring hot reload.
6. **RAG-Ready** – Offer local embedding & vector search options (e.g., `sqlite-vss`, `pgvector` shim) while supporting remote providers through adapters.

## 4. High-Level Architecture
```
┌──────────────────┐
│   Client Apps     │  (Next.js console, CLI, integrations)
└────────┬─────────┘
         │ HTTP/gRPC/WebSocket
┌────────▼─────────┐      ┌─────────────────────┐
│  API Gateway      │◄────►│  Auth Provider (OIDC│ (Keycloak, Auth0, API keys)
│  (Fastify/Express)│      │  , JWT, API Keys)   │
└────────┬─────────┘      └─────────────────────┘
         │
┌────────▼─────────────┐
│  Domain Services      │  (Nodes, Edges, Traversal, Metadata Import/Export)
│  - CQRS-style handlers│
│  - Validation         │
│  - Event emitters     │
└────────┬─────────────┘
         │
┌────────▼─────────────┐
│ SQLite Persistence    │
│ - graph_nodes table   │
│ - graph_edges table   │
│ - node_properties JSON│
│ - edge_properties JSON│
│ - CTEs for traversal  │
│ - FTS5, VSS, Triggers │
└────────┬─────────────┘
         │
┌────────▼─────────────┐
│ Optional Extensions   │
│ - Vector search (sqlite-vss, Qdrant adapter) │
│ - Audit/Event sink (Kafka, NATS, local file) │
│ - Analytics (DuckDB integration)             │
└──────────────────────┘
```

### Core Modules
1. **API Server**
   - Use Fastify (Node.js) or Axum (Rust) for performance and plugin ecosystem.
   - Bundle OpenAPI spec + automatic docs.
   - Implement the same routes as current worker (`/:orgId/nodes`, `/:orgId/edges`, `/orgs`, `/:orgId/metadata/export`, etc.).
   - Middleware chain: logging → CORS → rate limiting → auth → route handler.

2. **Storage Layer**
   - SQLite database file with migrations managed by Prisma, Kysely, or Drizzle (if Node) or SQLx (Rust).
   - Schema mirroring D1 tables:
     ```sql
     CREATE TABLE graph_nodes (
       id TEXT NOT NULL,
       org_id TEXT NOT NULL,
       type TEXT NOT NULL,
       properties JSON NOT NULL DEFAULT '{}',
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       created_by TEXT NOT NULL,
       updated_by TEXT NOT NULL,
       user_agent TEXT,
       client_ip TEXT,
       PRIMARY KEY (id, org_id)
     );
     CREATE INDEX idx_nodes_org_type ON graph_nodes(org_id, type);
     ```
   - Edges table with foreign-key enforcement.
   - Triggers to keep `updated_at` current.

3. **Traversal & Query Engine**
   - Re-implement traversals using recursive CTEs in SQLite.
   - Provide streaming iterators for large graphs.
   - Offer pluggable in-memory cache (LRU) for hot nodes (optional, default off).

4. **Embedding & Search**
   - Default: use SQLite JSON/FTS for text search.
   - Optional: integrate `sqlite-vss` extension or external vector DB (Qdrant, Weaviate) via adapter.
   - Provide background worker process for embedding generation (OpenAI, local transformers).

5. **Import/Export + Backup**
   - JSON-based import/export CLI using SQLite transactions.
   - Snapshot command to dump `.sqlite` file or `.sql`.
   - Supply migration from Cloudflare D1 (SQL export) to SQLite, using ETL script.

6. **Observability**
   - Structured logging (pino or bunyan) with log-level control.
   - Health checks (`/health/live`, `/health/ready`).
  - Optional Prometheus metrics endpoint.

## 5. Front-End & Tooling
1. **Web Console**
   - Reuse existing Next.js UI, replacing Cloudflare fetch URLs with configurable base URL.
   - Authentication via same OIDC provider or local API key (fallback, for demos).
   - Extend UI: graph visualization (D3/React Flow), node/edge editors, traversal explorer.

2. **CLI Tool**
   - Provide `metadata-cli` for:
     - Bootstrapping database (`metadata-cli init`).
     - Import/export (`metadata-cli export --org org1`).
     - Running migrations.
     - Launching API server (developer experience).

3. **SDKs**
   - TypeScript client library generated from OpenAPI.
   - Python client for ingestion scripts.

## 6. Deployment & Operations
| Target | Recommendation |
|--------|----------------|
| Local Development | `docker compose up` with API server + SQLite volume; autoreload options. |
| Self-hosted VM | Systemd service or Docker container; mount persistent volume for `.sqlite`. |
| Cloud | Works on any provider (AWS EC2, GCP Compute Engine, Fly.io). Optionally layer on managed SQLite services (LiteFS, Turso, PlanetScale serverless driver). |
| Scaling | Horizontal read replicas via Litestream/LiteFS; for larger workloads, allow migration path to Postgres while keeping same API. |

### Reliability
- Automatic WAL checkpointing and backup via Litestream or LiteFS.
- Transactional migrations with version table.
- Configurable rate limits and request quotas per org (Redis or in-process token bucket).

## 7. Security & Auth Strategy
- **Auth Modes** (pluggable):
  1. OIDC/JWT (Keycloak, Auth0, Azure AD).
  2. API keys per org (for service-to-service usage).
  3. mTLS (optional for enterprise).
- RBAC scope model identical to current system (`<orgId>:read`, `<orgId>:write`, wildcard).
- Audit logs stored in `audit_events` table (action, actor, timestamp, payload).
- Sensitive logging stripped (no token dumps).

## 8. Migration Path from Cloudflare Version
1. **Export** data from D1 using Wrangler or `cf-graphdb-api` export endpoint per org.
2. **Transform** exports (if necessary) to align with new schema using ETL script.
3. **Import** into SQLite using `metadata-cli import`.
4. **Redirect** front-end `.env` to new API URL.
5. **Replace** Cloudflare-specific env vars with new config file (`config/default.yaml`).

## 9. Delivery Plan & Milestones
| Phase | Duration | Deliverables |
|-------|----------|--------------|
| 0 – Discovery | 1 week | Detailed requirements, tech stack selection (Node/Fastify + Drizzle recommended). |
| 1 – Foundations | 2 weeks | SQLite schema + migration tooling, API skeleton with auth middleware, CI pipeline. |
| 2 – Core Features | 3 weeks | Nodes/edges CRUD, traversal/query, import/export, CLI bootstrap. |
| 3 – Vector + Search | 2 weeks | FTS integration, optional vector adapter, background embedding worker. |
| 4 – Front-end Integration | 2 weeks | Update Next.js console, OIDC/Auth wiring, UX improvements. |
| 5 – Hardening | 2 weeks | Performance tests (k6/Locust), security review, docs, packaging (Docker, binary). |
| 6 – Migration & Launch | 1 week | D1 → SQLite migration scripts, GA announcement. |

## 10. Risks & Mitigations
- **SQLite at Scale**: Single-writer limitation; mitigate with WAL mode, job queue for heavy writes, plan migration path to Postgres when needed.
- **Embedding Performance**: Running local embeddings may be resource-intensive; allow asynchronous pipelines and remote providers.
- **Auth Complexity**: Provide templates for OIDC and API key flows; include integration tests.
- **Data Consistency**: Without KV, rely on SQLite and optional in-memory caches; ensure delete/update handlers invalidate caches correctly.

## 11. Success Metrics
- Time-to-first-setup < 10 minutes (from `git clone` to running API with sample data).
- Import/export parity with Cloudflare version.
- Sustained throughput: 100 RPS read, 20 RPS write on mid-tier VM without errors.
- Traversal latency (depth=3, graph=5k nodes) < 300 ms median.
- 80% test coverage across API, storage, and CLI.

## 12. Next Steps
1. Approve scope and target stack (Fastify + TypeScript + Drizzle recommended).
2. Set up repository scaffold (`packages/api`, `packages/cli`, `apps/web`).
3. Author migration tool for current datasets (YouTube8M ingestion to SQLite).
4. Begin Phase 1 implementation with iterative demos every sprint.

_Prepared as a forward-looking plan leveraging lessons from the Cloudflare implementation while enabling a broader deployment footprint._.
