# API Reference

This section documents the available endpoints and authentication scheme.

## Authentication

All requests require a JSON Web Token (JWT) in the `Authorization` header using the Bearer format:

```
Authorization: Bearer <token>
```

### JWT Payload

| Field | Type | Description |
|-------|------|-------------|
| `sub` | string | User identifier |
| `email` | string | User email address |
| `permissions` | string | Comma separated permission scopes |

Permissions follow the `<scope>:<level>` syntax. Examples:

- `org1:read` – read-only access for the specified organisation
- `org2:write` – write access for `org2`
- `*:*` – full access to all organisations

## Endpoints

All endpoints are scoped by organisation ID in the URL.

### Nodes

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/:orgId/nodes` | List nodes | `read` |
| POST | `/:orgId/nodes` | Create node | `write` |
| GET | `/:orgId/nodes/:id` | Fetch node | `read` |
| PUT | `/:orgId/nodes/:id` | Update node | `write` |
| DELETE | `/:orgId/nodes/:id` | Delete node | `write` |

### Edges

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/:orgId/edges` | List edges | `read` |
| POST | `/:orgId/edge` | Create edge | `write` |
| GET | `/:orgId/edge/:edgeId` | Fetch edge | `read` |
| PUT/PATCH | `/:orgId/edge/:edgeId` | Update edge | `write` |
| DELETE | `/:orgId/edge/:edgeId` | Delete edge | `write` |

### Graph Operations

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/:orgId/query` | Query graph | `read` |
| POST | `/:orgId/traverse` | Traverse graph | `read` |

### Metadata Management

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/:orgId/metadata/export` | Export graph | `read` |
| POST | `/:orgId/metadata/import` | Import graph | `write` |

## Errors

| Status | Meaning |
|-------|---------|
| 401 | Unauthorized token |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 500 | Internal server error |

Example:

```json
{
  "message": "Forbidden: Insufficient permissions to access this resource"
}
```

## Permission Levels by Method

| Method | Required level |
|--------|----------------|
| GET | `read` or higher |
| POST | `write` or higher |
| PUT/PATCH | `write` or higher |
| DELETE | `write` or higher |
| HEAD | `audit` or higher |

See [architecture.md](architecture.md) for how the API is implemented.
