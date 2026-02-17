# db-view-mcp

MCP server that gives AI assistants direct access to PostgreSQL and ClickHouse databases. Supports stdio and HTTP transports, allowing both local IDE integration and remote network access.

## Features

- **Multi-database** — connect to any number of PostgreSQL and ClickHouse instances simultaneously
- **Dual transport** — stdio for IDE integration (Cursor, Claude Code), HTTP for remote/multi-client access
- **Read & write tools** — SELECT queries with row limits, INSERT/UPDATE/DELETE, DDL, transactions
- **Schema introspection** — list tables, describe columns, export full DDL
- **Query analysis** — EXPLAIN ANALYZE support, slow query tracking
- **SQL safety** — read-only tools validate SQL to block accidental writes
- **Flexible tool modes** — single tool with `database` parameter, or separate tool per database
- **Lazy connections** — databases connect on first use by default
- **Bearer auth** — optional token-based authentication for HTTP transport
- **Session management** — stateful (per-session MCP server) or stateless HTTP mode

## Quick start

### Install

```bash
npm install @conte777/db-view-mcp
```

Or clone and build from source:

```bash
git clone <repo-url>
cd db-view-mcp
npm install
npm run build
```

### Configure

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

Minimal config (stdio, default):

```json
{
  "databases": [
    {
      "id": "main_pg",
      "type": "postgresql",
      "host": "localhost",
      "port": 5432,
      "database": "myapp",
      "user": "admin",
      "password": "secret123"
    }
  ]
}
```

HTTP transport config:

```json
{
  "transport": {
    "type": "http",
    "port": 3000,
    "host": "127.0.0.1",
    "stateless": false,
    "auth": {
      "type": "bearer",
      "token": "your-secret-token"
    }
  },
  "databases": [
    {
      "id": "main_pg",
      "type": "postgresql",
      "host": "localhost",
      "port": 5432,
      "database": "myapp",
      "user": "admin",
      "password": "secret123"
    }
  ]
}
```

### Run

```bash
# Stdio (default)
npm start -- --config config.json

# HTTP via config (set transport.type to "http" in config.json)
npm start -- --config config.json

# HTTP via CLI flag (overrides config)
npm start -- --config config.json --transport http

# Development (no build needed)
npm run dev -- --config config.json
```

### Add to your MCP client

**Claude Desktop** (`claude_desktop_config.json`) — stdio:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@conte777/db-view-mcp", "--config", "/path/to/config.json"]
    }
  }
}
```

**Claude Code** (`.mcp.json`) — stdio:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@conte777/db-view-mcp", "--config", "/path/to/config.json"]
    }
  }
}
```

**Any MCP client** — HTTP:

```bash
# Start the server
node dist/index.js --config config.json --transport http
# Server listens on http://127.0.0.1:3000/mcp
```

## Transport modes

### Stdio (default)

Communication via stdin/stdout. Best for local IDE integrations where the MCP client spawns the server process.

### HTTP

Uses the MCP Streamable HTTP transport (`POST/GET/DELETE /mcp`). Best for:
- Remote access over the network
- Multiple clients connecting simultaneously
- Web application integrations

**Stateful mode** (default): each MCP session gets its own `McpServer` instance with a unique session ID. All sessions share database connection pools. Supports transactions across requests within the same session.

**Stateless mode** (`"stateless": true`): no session management. Each request is independent. Suitable for simple query scenarios without transactions.

#### HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | Send JSON-RPC requests (initialize, tools/call, etc.) |
| `GET` | `/mcp` | SSE stream for server-to-client notifications |
| `DELETE` | `/mcp` | Close a session |
| `GET` | `/health` | Health check — status, active sessions, database list |

#### Authentication

Optional bearer token authentication:

```json
{
  "transport": {
    "type": "http",
    "auth": {
      "type": "bearer",
      "token": "your-secret-token"
    }
  }
}
```

Requests to `/mcp` must include `Authorization: Bearer your-secret-token`. Requests without a valid token receive `401 Unauthorized`. The `/health` endpoint is not protected.

#### Example: initialize a session

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "1.0" }
    }
  }'
```

The response includes a `Mcp-Session-Id` header. Use it in subsequent requests:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer your-secret-token" \
  -H "Mcp-Session-Id: <session-id-from-init>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

## Tools

### Read-only

| Tool | Description |
|------|-------------|
| `query` | Execute a SELECT query with automatic row limit |
| `list_databases` | List all configured database connections |
| `list_tables` | List tables and views in a schema |
| `describe_table` | Get column names, types, nullability, and primary keys |
| `schema` | Export full DDL for a database |
| `explain_query` | Run EXPLAIN ANALYZE (PostgreSQL) or EXPLAIN (ClickHouse) |
| `performance` | Track and retrieve slow queries, set thresholds |

### Write

| Tool | Description |
|------|-------------|
| `execute` | Run INSERT, UPDATE, DELETE, or DDL statements |
| `transaction` | Begin, execute within, commit, or rollback transactions (PostgreSQL only) |

## Configuration

### Transport

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transport.type` | `"stdio"` \| `"http"` | `"stdio"` | Transport mode |
| `transport.port` | number | `3000` | HTTP listen port |
| `transport.host` | string | `"127.0.0.1"` | HTTP bind address |
| `transport.stateless` | boolean | `false` | Disable session management |
| `transport.auth.type` | `"bearer"` | — | Authentication type |
| `transport.auth.token` | string | — | Bearer token value |

The `transport` field is optional. When omitted, stdio is used. The `--transport` CLI flag overrides the config value.

### Defaults

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRows` | number | `100` | Maximum rows returned by `query` |
| `lazyConnection` | boolean | `true` | Connect on first use instead of at startup |
| `toolsPerDatabase` | boolean | `false` | Register separate tools per database (e.g. `query_main_pg`) |
| `queryTimeout` | number | `30000` | Query timeout in milliseconds |

### PostgreSQL database

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | yes | — | Unique identifier |
| `type` | yes | — | Must be `"postgresql"` |
| `host` | yes | — | Hostname |
| `port` | no | `5432` | Port |
| `database` | yes | — | Database name |
| `user` | yes | — | Username |
| `password` | no | `""` | Password |
| `ssl` | no | — | Enable SSL |
| `description` | no | — | Human-readable label |
| `lazyConnection` | no | inherits | Override default |
| `maxRows` | no | inherits | Override default |
| `queryTimeout` | no | inherits | Override default |

### ClickHouse database

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | yes | — | Unique identifier |
| `type` | yes | — | Must be `"clickhouse"` |
| `url` | yes | — | HTTP URL (e.g. `http://localhost:8123`) |
| `database` | yes | — | Database name |
| `user` | no | `"default"` | Username |
| `password` | no | `""` | Password |
| `description` | no | — | Human-readable label |
| `lazyConnection` | no | inherits | Override default |
| `maxRows` | no | inherits | Override default |
| `queryTimeout` | no | inherits | Override default |

### Per-database tool mode

Set `"toolsPerDatabase": true` in defaults to register a separate tool for each database. Instead of a single `query` tool with a `database` parameter, you get `query_main_pg`, `query_analytics`, etc. Useful when connecting many databases to avoid parameter confusion.

## Architecture

```
src/
├── index.ts              Entry point: CLI args → config → transport routing
├── server.ts             Creates McpServer + ConnectorManager, registers tools
├── config/
│   ├── types.ts          Zod schemas for config validation (transport, databases)
│   └── loader.ts         Reads config file, parses CLI args (--config, --transport)
├── connectors/
│   ├── interface.ts      Connector interface and shared types
│   ├── manager.ts        Connector lifecycle (lazy/eager, create, disconnect)
│   ├── postgresql.ts     PostgreSQL implementation (pg)
│   └── clickhouse.ts     ClickHouse implementation (@clickhouse/client)
├── tools/
│   ├── registry.ts       Registers tools in parameter or per-database mode
│   ├── readonly/         query, list-tables, describe-table, schema, explain, performance
│   └── write/            execute, transaction
├── transport/
│   └── http.ts           HTTP transport: Express app, session management, auth
└── utils/
    ├── response.ts       Standardized MCP response formatting
    └── sql-validator.ts   Blocks write keywords in read-only queries
```

## ClickHouse limitations

- Transactions are not supported (throws an error)
- Query parameters via `params` are ignored — use ClickHouse's native `{name:Type}` syntax in SQL

## Development

```bash
npm run dev -- --config config.json   # Run with tsx, auto-reload
npm run build                         # Compile TypeScript to dist/
npm start -- --config config.json     # Run compiled output
```

## License

MIT
