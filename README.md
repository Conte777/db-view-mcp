# db-view-mcp

An MCP server that gives AI assistants direct access to PostgreSQL and ClickHouse databases. It
supports both stdio and HTTP transports, for local IDE integration and remote network access.

## Features

- **Multi-database** — connect any number of PostgreSQL and ClickHouse instances at once
- **Dual transport** — stdio for IDE integration (Cursor, Claude Code), HTTP for remote/multi-client access
- **Read & write tools** — SELECT with row limits, INSERT/UPDATE/DELETE, DDL, transactions
- **Schema introspection** — list tables, describe columns, export full DDL
- **Query analysis** — EXPLAIN / EXPLAIN ANALYZE, slow-query tracking
- **SQL safety** — read-only tools validate SQL and block accidental writes
- **Flexible tool modes** — one tool with a `database` parameter, or a separate tool per database
- **Lazy connections** — databases connect on first use by default
- **Bearer auth** — optional token authentication for the HTTP transport
- **Session management** — stateful (per-session MCP server) or stateless HTTP mode

## Install

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

## Quick start

### 1. Configure

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

Minimal stdio config:

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

Every field, default, and the full config reference (SSL/TLS, per-database overrides, environment
substitution, HTTP transport) is in [docs/configuration.md](docs/configuration.md).

### 2. Run

```bash
# Stdio (default)
npm start -- --config config.json

# HTTP (set transport.type to "http" in config, or override on the CLI)
npm start -- --config config.json --transport http

# Development (no build needed)
npm run dev -- --config config.json
```

### 3. Add an MCP client

**Claude Desktop** (`claude_desktop_config.json`) or **Claude Code** (`.mcp.json`), stdio:

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

**Any MCP client**, HTTP:

```bash
node dist/index.js --config config.json --transport http
# Server listens on http://127.0.0.1:3000/mcp
```

See [docs/http-transport.md](docs/http-transport.md) for sessions, auth, and curl examples.

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/configuration.md](docs/configuration.md) | Every config field, defaults, SSL/TLS, `rowFormat`, env substitution, hot reload |
| [docs/tools.md](docs/tools.md) | The 9 tools: params, output, examples, error codes, per-database mode |
| [docs/http-transport.md](docs/http-transport.md) | stdio vs HTTP, sessions, bearer auth, `/health`, curl |
| [docs/security.md](docs/security.md) | Read-only SQL validator, deny-lists, response caps, network exposure |
| [docs/architecture.md](docs/architecture.md) | Source tree, layers, connector model, lifecycle (hot reload, shutdown) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, test, lint, hooks, CI |

## ClickHouse limitations

- Transactions are not supported (`transaction begin` throws).
- Query `params` are ignored — use ClickHouse's native `{name:Type}` syntax in the SQL.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for build/test/lint commands, coverage thresholds, git
hooks, and CI.

## License

MIT
