# db-view-mcp

MCP server that gives AI assistants direct access to PostgreSQL and ClickHouse databases. Connects via stdio transport and exposes tools for querying, schema inspection, and data manipulation.

## Features

- **Multi-database** — connect to any number of PostgreSQL and ClickHouse instances simultaneously
- **Read & write tools** — SELECT queries with row limits, INSERT/UPDATE/DELETE, DDL, transactions
- **Schema introspection** — list tables, describe columns, export full DDL
- **Query analysis** — EXPLAIN ANALYZE support, slow query tracking
- **SQL safety** — read-only tools validate SQL to block accidental writes
- **Flexible tool modes** — single tool with `database` parameter, or separate tool per database
- **Lazy connections** — databases connect on first use by default

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

```json
{
  "defaults": {
    "maxRows": 100,
    "lazyConnection": true,
    "toolsPerDatabase": false,
    "queryTimeout": 30000
  },
  "databases": [
    {
      "id": "main_pg",
      "type": "postgresql",
      "host": "localhost",
      "port": 5432,
      "database": "myapp",
      "user": "admin",
      "password": "secret123",
      "description": "Main PostgreSQL"
    },
    {
      "id": "analytics",
      "type": "clickhouse",
      "url": "http://localhost:8123",
      "database": "analytics",
      "user": "default",
      "password": "",
      "description": "ClickHouse analytics"
    }
  ]
}
```

### Run

```bash
# Development (no build needed)
npm run dev -- --config config.json

# Production
npm run build
npm start -- --config config.json
```

### Add to your MCP client

Claude Desktop (`claude_desktop_config.json`):

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

Claude Code (`.mcp.json`):

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
├── index.ts              Entry point: CLI args → config → server → stdio
├── server.ts             Creates McpServer, resolves configs, registers tools
├── config/
│   ├── types.ts          Zod schemas for config validation
│   └── loader.ts         Reads and parses config file
├── connectors/
│   ├── interface.ts      Connector interface and shared types
│   ├── manager.ts        Connector lifecycle (lazy/eager, create, disconnect)
│   ├── postgresql.ts     PostgreSQL implementation (pg)
│   └── clickhouse.ts     ClickHouse implementation (@clickhouse/client)
├── tools/
│   ├── registry.ts       Registers tools in parameter or per-database mode
│   ├── readonly/         query, list-tables, describe-table, schema, explain, performance
│   └── write/            execute, transaction
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
