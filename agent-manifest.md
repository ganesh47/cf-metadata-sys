# CF Metadata System – Agent Manifest

## 1. Project Synopsis
- **Goal**: Explore whether Cloudflare’s edge primitives can host a cost-efficient metadata platform that blends graph databases with LLM-backed semantics. Core hypothesis and outline live in `metadata_system_an_experiment.md` and `OUTLINE.md`.
- **Primary deliverables**: GraphDB Worker API (`cf-graphdb-api`), a Next.js control plane (`cf-graphdb-app`), Python-based performance harness (`performance/api`), and ingestion tooling for the YouTube8M case study (`problems/youtube`).
- **Key idea**: Store structured lineage in D1, cache hot reads in KV, export/import snapshots via R2, and enrich relationships with embeddings (Together API → Qdrant) to unlock GraphRAG-style retrieval flows.

## 2. Repository Layout (top level)
- `cf-graphdb-api/`: Cloudflare Worker that exposes the graph database API. Typescript + Vitest.
- `cf-graphdb-app/`: Next.js + HeroUI front-end that handles OIDC login, org selection, and node browsing.
- `performance/api/`: Python load and traversal tests that stress the stage deployment and generate latency reports.
- `problems/youtube/`: Dataset ingestion scripts for YouTube8M vocabulary and video metadata (posts into the API).
- `pages/`: Static `blocked.html` (login throttling / access denied page placeholder).
- `working/`: Ops utilities (deployment cleanup scripts, origin certs) – treat as operational artifacts, not app code.
- Documentation roots: `README.md`, `OUTLINE.md`, `metadata_system_an_experiment.md`.

## 3. GraphDB Worker (cf-graphdb-api)
- **Entry point**: `src/index.ts` wires routing, auth, database initialization, and logging (structured logger with request-scoped trace context).
- **Routing**: `src/routes.ts` maps REST patterns to handlers in `src/graph`. `publicRoutes` currently include `/orgs` and `/auth/callback`; all else requires JWT.
- **Persistence**:
  - D1 tables defined/initialised via `src/d1/initDb.ts`. Tables: `graph_nodes`, `graph_edges` with composite PK `(id, org_id)` and audit fields.
  - KV (`GRAPH_KV`) caches nodes (read-through updates on create/get); edges fetched directly from D1.
  - R2 (`GRAPH_BUCKET`) stores export snapshots.
- **Auth**:
  - OIDC discovery + JWKS caching in `src/auth.ts`. Accepts `Authorization: Bearer` or `session` cookie.
  - Permission scopes follow `<orgId>:<level>` where levels ∈ {`read`, `write`, `audit`} with wildcard support.
  - `/auth/callback` exchanges authorization code for tokens, verifies `id_token`, and sets secure cookies (`session`, `session_visible`).
- **Graph Operations** (see `src/graph/*.ts`):
  - Nodes: CRUD with pagination, sorting (default `created_at DESC`), and CORS support when `CORS_ALLOWED_ORIGINS` set.
  - Edges: CRUD + Qdrant embedding upserts (properties can declare `vectorize` keys to embed using Together AI `m2-bert-80M-32k-retrieval` model).
  - Traversals: Depth-limited DFS (default depth 3) gathering nodes, edges, and path sequences; filterable by relationship types.
  - Query: Combined node/edge fetch with optional type filters, returning deduplicated results + metadata.
  - Import/Export: JSON payload import writes through D1 and KV; export dumps org scope, stores to R2, returns the snapshot.
- **Utilities**: `src/utils/embed.ts` holds Together client (API key injected at runtime). Logging in `src/logger/logger.ts`. `src/cors.ts` adds `Access-Control-*` headers when enabled.
- **Configuration**:
  - `package.json` scripts: `npm run dev` (Wrangler dev), `npm run test:stage`, `npm run deploy:*`, `npm run lint`, `npm run type-check`.
  - `wrangler.jsonc` defines dev/stage bindings (D1 DB IDs, KV namespaces, R2 buckets) and log levels (`performance` in dev, `warn` in stage).
  - `schema.yml` contains the OpenAPI definition for external reference.
- **Testing**:
  - Vitest suites under `test/` cover auth guards, routing, node/edge/ops behavior, and org discovery.
  - CI (`.github/workflows/cf-graphdb-api.yml`) runs lint, type-check, coverage tests, deploys stage, then executes Python load tests (50 concurrent requests) with real OIDC creds/Keycloak service accounts.

## 4. Front-End Control Plane (cf-graphdb-app)
- **Stack**: Next.js App Router, HeroUI, deployed through Cloudflare Pages/Workers (see `wrangler.jsonc`, `open-next.config.ts`).
- **Login flow**:
  - Landing (`src/app/page.tsx`) loads `/orgs` from the Worker (cookie-auth). On failure, prompts OIDC sign-in via discovery document (env-driven).
  - Successful login stores `session` cookie; org list populates `Select`.
  - Selecting org redirects to `/dashboard?org=...`.
- **Dashboard (`src/app/dashboard`)**:
  - `RenderNodes` fetches `/${org}/nodes` via API, shows card list of nodes & key/value properties.
  - Logout clears `session_visible` cookie and redirects to `/`.
- **Env variables**: Expect `NEXT_PUBLIC_OIDC_WORKER_BASE`, `NEXT_PUBLIC_OIDC_DISCOVERY_URL`, `NEXT_PUBLIC_OIDC_CLIENT_ID`. These mirror Worker endpoints and IdP metadata.
- **Scripts**: `npm run dev`, `npm run lint`, `npm run test`, `npm run deploy:stage` (Wrangler). Vitest config in `vitest.config.ts`; tests live in `test/`.
- **HeroUI theme**: `hero.ts` exports design system plugin; `providers.tsx` wraps layout with UI provider.

## 5. Performance & Tooling
- `performance/api/load.py`: Spins up 100 nodes + 200 random edges under `/load-test` org, executes CRUD/query/traverse operations, captures latency distributions, status tallies, and phase timings. Uses real OIDC password grant (Keycloak test user).
- `performance/api/traversal-test.py`: Builds linear chains and benchmarks multi-hop traversals.
- Logs saved in `performance/api/load_test_latency_*.log`; HTML percentile report `load_test_report_*.html`.
- Requires env (CI injects):
  - `CF_WORKER_URL`, `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
  - `KEYCLOAK_TEST_USER`, `KEYCLOAK_TEST_PASS`
  - Optional tuning: `CF_CONCURRENT_REQUESTS`
- Python deps pinned in `performance/api/requirements.txt` (httpx, tqdm, pandas for ingestion scripts).

## 6. YouTube8M Case Study Assets
- Located in `problems/youtube/`.
- `ingest_vocab_nodes.py` & `ingest_youtube_video_nodes.py` stream dataset records into the API (`/youtube/nodes` etc.) using HS256 JWT signed with `ENV_JWT_SECRET`.
- Input data: `vocabulary.csv.gz`, `youtube8m_flat.csv.gz`; ingestion uses async `httpx` with configurable concurrency.
- Highlights the GraphRAG experimentation context referenced in top-level docs.

## 7. Environment & Secrets Checklist
- Worker (API) expects:
  - `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
  - `KEYCLOAK_TEST_USER/PASS` for integration tests
  - `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_EDGE_COLLECTION`
  - `TOGETHER_API_KEY`
  - `CORS_ALLOWED_ORIGINS` (optional; enables CORS and used by frontend)
  - `HOME_URL`, `ROUTER_PREFIX`, `INIT_DB`, `LOG_LEVEL`
- Front-end relies on matching `NEXT_PUBLIC_` prefixed values plus the Worker base URL.
- JWT fallback secret `JWT_SECRET` remains for legacy HS256 testing, but production uses OIDC.

## 8. Running Locally
1. **API Worker**:
   ```bash
   cd cf-graphdb-api
   npm install
   wrangler dev --env dev
   # tests
   npm run lint
   npm run type-check
   npm run test
   ```
   Ensure `.dev.vars` supplies OIDC/Qdrant/Together keys (see CI for template).
2. **Front-end**:
   ```bash
   cd cf-graphdb-app
   npm install
   npm run dev
   ```
   Configure `.env.local` with `NEXT_PUBLIC_OIDC_*` values pointing at local Worker dev tunnel.
3. **Performance Tests**:
   ```bash
   cd performance/api
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   CF_WORKER_URL=http://127.0.0.1:8787 OIDC_DISCOVERY_URL=... python load.py
   ```

## 9. Quality & Observability
- SonarCloud pipeline (`.github/workflows/sonar-ci.yml`) scans the codebase (primarily Worker/API).
- Wrangler’s observability enabled (`wrangler.jsonc → observability.enabled: true`) for request traces/logs.
- Logger outputs JSON suitable for Logpush dashboards (includes requestId, operation, durations).

## 10. Open Questions / Future Directions
- GraphRAG integration currently limited to edge embeddings; broader pipeline (vector search → traversal) still experimental.
- Need production-ready Together/Qdrant key management and rate-limit handling (no retries/backoff yet).
- KV cache invalidation strategy for updates/deletes could be enhanced (deletes remove KV entries? ensure `deleteNode`/`deleteEdge` maintain cache parity).
- Front-end presently read-only list; editing/import actions must be guarded before exposing in production.

## 11. Quick References
- Key docs: `cf-graphdb-api/docs/architecture.md`, `docs/api-reference.md`, `docs/environments.md`.
- OpenAPI spec: `cf-graphdb-api/schema.yml`.
- Auth helper: `cf-graphdb-api/src/auth.ts`.
- Traversal logic: `cf-graphdb-api/src/graph/traversals.ts`.
- Embedding helper: `cf-graphdb-api/src/utils/embed.ts`.
- Performance logs: `performance/api/*.log`.

_Maintained for future agent sessions; update when architecture, dependencies, or operational processes change._
