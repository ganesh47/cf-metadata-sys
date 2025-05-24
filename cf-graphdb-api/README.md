# Architecture Overview
This GraphDB implementation leverages Cloudflare's storage services strategically:

**Workers KV** serves as a high-performance cache layer for frequently accessed nodes and maintains adjacency lists for fast graph traversal. The eventually consistent nature of KV is acceptable here since we use D1 as the source of truth.

**D1** Database provides the durable storage foundation for storing nodes and edges with proper indexing for complex queries. This ensures data consistency and supports SQL-based graph queries.

**R2** Object Storage handles metadata exports and backups, storing large graph snapshots without egress fees. This is ideal for data archival and disaster recovery scenarios.

Key Features
**Node Management**: Create, read, update, and delete graph nodes with typed properties and metadata. Each node has a unique ID, type classification, and flexible property storage.

**Edge Relationships**: Define directed relationships between nodes with custom relationship types and properties. The system maintains bidirectional adjacency lists for efficient traversal.

**Graph Querying**: Execute complex queries filtering by node types, relationship types, and properties. The hybrid storage approach enables both fast lookups and complex analytical queries.

**Graph Traversal**: Perform depth-limited graph traversal starting from any node, with optional relationship type filtering. This supports use cases like dependency analysis and relationship mapping.

**Metadata Export/Import**: Full graph serialization to R2 for backup and migration purposes. This enables data portability and disaster recovery workflows.

The system combines the strengths of each Cloudflare storage service: KV for speed, D1 for consistency, and R2 for durability, creating a robust foundation for metadata management systems that require graph-like data relationships and fast global access patterns.


# API Documentation

## Authentication

The API uses JSON Web Tokens (JWT) for authentication. All requests must include a valid JWT in the `Authorization` header using the Bearer token format.

```
Authorization: Bearer <token>
```


### JWT Payload Requirements

The JWT payload must contain the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `sub` | string | User ID (required) |
| `email` | string | User email address (required) |
| `permissions` | string | Comma-separated list of permission scopes (optional) |

#### Permission Format

Permissions use the format `<scope>:<level>` where:

- `scope`: Organization ID or wildcard (`*`)
- `level`: One of the following permission levels (in ascending order of access):
	- `read`: Can view resources
	- `write`: Can create/modify/delete resources (includes read access)
	- `audit`: Can perform audit operations (excludes read and write access and can only read audit meta-metadata)
    - `*`: Can perform any operation including audit.

Examples:
- `org1:read` - Read-only access to organization 'org1'
- `org2:write` - Write access to organization 'org2'
- `*:read` - Read-only access to all organizations
- `org1:read,org2:write` - Read access to 'org1', write access to 'org2'
- `*:*` - Full access to all organizations
- `*:audit` - All orgs centralized audit

## API Endpoints

All endpoints are organization-scoped. The organization ID is specified in the URL path.

### Nodes

| Method | Endpoint | Description | Required Permission |
|--------|----------|-------------|---------------------|
| GET | `/:orgId/nodes` | List all nodes | `read` |
| POST | `/:orgId/nodes` | Create a new node | `write` |
| GET | `/:orgId/nodes/:id` | Get a specific node | `read` |
| PUT | `/:orgId/nodes/:id` | Update a specific node | `write` |
| DELETE | `/:orgId/nodes/:id` | Delete a specific node | `write` |

### Edges

| Method       | Endpoint               | Description             | Required Permission |
|--------------|------------------------|-------------------------|---------------------|
| GET          | `/:orgId/edges`        | List all edges          | `read`              |
| POST         | `/:orgId/edge`         | Create a new edge       | `write`             |
| GET          | `/:orgId/edge/:edgeId` | Create a new edge       | `read`              |
| PUT or PATCH | `/:orgId/edge/:edgeId` | Update an existing edge | `write`             |
| DELETE       | `/:orgId/edge/:edgeId` | Delete an existing edge | `write`             |

### Graph Operations

| Method | Endpoint | Description | Required Permission |
|--------|----------|-------------|---------------------|
| POST | `/:orgId/query` | Query the graph | `read` |
| POST | `/:orgId/traverse` | Traverse the graph | `read` |

### Metadata Management

| Method | Endpoint | Description | Required Permission |
|--------|----------|-------------|---------------------|
| GET | `/:orgId/metadata/export` | Export metadata | `read` |
| POST | `/:orgId/metadata/import` | Import metadata | `write` |

## Error Responses

| Status Code | Description |
|-------------|-------------|
| 401 | Unauthorized - Missing or invalid authentication token |
| 403 | Forbidden - Insufficient permissions to access the resource |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error - Unexpected error |

### Example Error Response

```json
{
  "message": "Forbidden: Insufficient permissions to access this resource"
}
```


## Permission Requirements By Method

| HTTP Method | Required Permission Level |
|-------------|---------------------------|
| GET | `read` (or higher) |
| POST | `write` (or higher) |
| PUT | `write` (or higher) |
| PATCH | `write` (or higher) |
| DELETE | `write` (or higher) |

## Security Considerations

- All API endpoints require valid authentication
- Permissions are scoped to specific organizations (Unless a wildcard org+permission is provided!)
- JWT tokens should have a reasonable expiration time
- Use HTTPS for all API requests to ensure data security
