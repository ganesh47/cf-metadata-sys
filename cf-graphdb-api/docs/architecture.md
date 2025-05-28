# Architecture

This module implements the API layer for the GraphDB. Metadata is modeled as typed nodes and directed edges with arbitrary properties. The service composes multiple Cloudflare primitives to balance cost and performance:

- **Workers KV** – Provides a globally distributed cache for hot nodes and adjacency lists, accelerating read heavy access patterns.
- **D1** – The relational source of truth. All nodes and edges are persisted here with indexes tuned from measured access patterns. Reads and writes are carefully optimized because each operation is billable.
- **R2** – Used for metadata exports, backups and large snapshot storage. This avoids egress fees and allows disaster‑recovery workflows.

Edge properties are also vectorized for future LLM based retrieval‑augmented generation workflows. Embeddings are produced using together.ai models and stored in QDrant. We evaluated the Cloudflare Vectorize service but opted for QDrant for lower cost at our expected query volume.

## Key Features

- **Node Management** – CRUD operations on typed nodes with flexible property storage.
- **Edge Relationships** – Directed edges with custom relationship types. Bidirectional adjacency lists enable efficient traversal.
- **Graph Querying** – Filter by node type, relationship type and properties. The hybrid storage approach supports both OLTP and analytical queries.
- **Graph Traversal** – Depth limited traversal with optional relationship filtering.
- **Metadata Export / Import** – Full graph serialization to and from R2.

## Security and Authentication

Every endpoint is protected using an OpenID Connect (OIDC) based flow. Tokens are issued by our identity provider (Keycloak in development, Cloudflare Access in staging and production). Requests must include either an `Authorization` header or a `session` cookie containing the JWT. The service retrieves the provider's discovery document at startup and caches the JWKS for signature verification.

An authentication middleware runs before all route handlers:

1. Extract the JWT from the request.
2. Verify it with the cached JWKS, validating issuer, audience and expiration.
3. Parse the custom `permissions` claim which lists scopes in the form `<orgId>:<level>`.
4. Compare the required scope for the route with the token's permissions and reject the request if it does not match.

Pseudo code for the guard logic:

```ts
async function authGuard(req, env, next, required) {
  const token = extractJwt(req);
  if (!token) return unauthorized();
  const payload = await verifyJwt(token, env.jwks);
  const scope = `${req.params.orgId}:${required}`;
  if (!payload.permissions.includes(scope) && !payload.permissions.includes('*:*')) {
    return forbidden();
  }
  req.user = payload;
  return next();
}
```

### Tests

The [`auth.spec.ts`](../test/auth.spec.ts) suite contains unit and integration tests that exercise the middleware. It verifies behaviour for missing tokens, invalid signatures and full end‑to‑end OIDC login. The integration test exchanges a code with the identity provider, validates the returned JWT using the provider's JWKS and then accesses protected routes. By asserting that the `permissions` claim is honoured, these tests demonstrate that scope checks prevent unauthorised access.

See [environments.md](environments.md) for details on the different deployment environments.
