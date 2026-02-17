# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

MCP (Model Context Protocol) server providing database access tools for AI assistants. Supports PostgreSQL and ClickHouse. Communicates over stdio or HTTP (StreamableHTTP) transport.

## Commands

```bash
npm run build          # TypeScript → dist/
npm run dev            # Run with tsx (no build needed)
npm run start          # Run compiled dist/index.js
```

The server requires `--config <path>` CLI argument pointing to a JSON config file (see `config.example.json`). Optional `--transport stdio|http` overrides config.

## Architecture

**Entry flow:** `src/index.ts` → parses CLI args → loads config → stdio or HTTP transport based on config/CLI flag.

**Key layers:**

- **Config** (`src/config/`): Zod-validated config with `transport` (stdio default or http), `defaults` (maxRows, lazyConnection, toolsPerDatabase, queryTimeout), and `databases[]` array. Each DB config is a discriminated union on `type` field (`postgresql` | `clickhouse`). Per-DB settings override defaults via `resolveDbConfig()`.

- **Connectors** (`src/connectors/`): `Connector` interface defines the contract (query, execute, listTables, describeTable, getSchema, explain, beginTransaction). `ConnectorManager` handles lazy/eager connection and connector lifecycle. PostgreSQL uses `pg.Pool`; ClickHouse uses `@clickhouse/client`.

- **Tools** (`src/tools/`): MCP tools split into `readonly/` and `write/`. Each tool file exports a `createXxxParams()` (Zod schema) and `xxxHandler()` (closure over ConnectorManager). `registry.ts` registers tools in one of two modes:
  - **Parameter mode** (default): single tool per action, `database` param selects DB
  - **Per-database mode** (`toolsPerDatabase: true`): separate tool per DB (e.g., `query_main_pg`)

- **Transport** (`src/transport/`): HTTP transport via `StreamableHTTPServerTransport` on Express. Two modes: **stateful** (session-based, `mcp-session-id` header) and **stateless** (new server per request). Optional Bearer auth. Health endpoint at `GET /health`.

- **Utils** (`src/utils/`): `sql-validator.ts` blocks write keywords in read-only queries; `response.ts` standardizes JSON responses with `formatSuccess`/`formatError`/`formatRows`.

**ClickHouse limitations:** Transactions not supported (throws). Query params (`_params`) ignored — ClickHouse uses its own `query_params` syntax.

## Adding a new tool

1. Create handler file in `src/tools/readonly/` or `src/tools/write/`
2. Export `createXxxParams(dbIds)` returning Zod schema object and `xxxHandler(manager)` returning async handler
3. Register in `src/tools/registry.ts` — add to both `registerParameterTools()` and `registerPerDatabaseTools()`

## Tech stack

- TypeScript (ES2022, Node16 module resolution, strict mode)
- `@modelcontextprotocol/sdk` for MCP server
- `pg` for PostgreSQL, `@clickhouse/client` for ClickHouse
- `zod` v4 for config and tool param validation
- `express` v5 for HTTP transport
- No test framework configured
