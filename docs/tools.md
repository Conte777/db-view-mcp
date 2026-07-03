# Tools

Nine MCP tools: seven read-only, two write. Every response is a JSON object with `success: true`
plus payload, or `success: false` with `error` (and sometimes `code`) — see
[Error codes](#error-codes). Read-only tools gate SQL through the
[read-only validator](security.md) before touching the database.

By default there is one tool per operation with a `database` parameter. With
`"toolsPerDatabase": true` the `database` param disappears and each tool is registered per
database as `query_<id>`, `list_tables_<id>`, … — see [Per-database tool mode](#per-database-tool-mode).

Source of truth: `src/tools/**`, `src/connectors/interface.ts`, `src/utils/resolve-db.ts`,
`src/utils/response.ts`.

## Database resolution

Every tool takes a `database` id, resolved **fuzzily** so an inexact id still lands: exact match →
case-insensitive → normalized (dashes/underscores stripped) → unique token-aligned
abbreviation/superset (e.g. `api` → `api_go`, `analytics_db` → `analytics`). Matches only align at
token boundaries and the matched id must be ≥ 3 chars, so a 2-char input can't silently hit an
unrelated longer id. Two matches → `DB_AMBIGUOUS`; none → `DB_NOT_FOUND`. The resolved (canonical)
id is echoed back in the response `database` field.

---

## query

Read-only `SELECT`. SQL is validated, comment/semicolon-stripped, then wrapped as
`SELECT * FROM (<your sql>) AS _q LIMIT <n>` and (PostgreSQL) run inside a `READ ONLY` transaction.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `sql` | string | yes | `SELECT` query |
| `maxRows` | positive int | no | Row cap. **Can only lower the configured `maxRows`, never raise it** (`min(maxRows, configured)`) |

Output: `{ success: true, rows: [...], count, database }` (or `rowsTable` instead of `rows` in
[table mode](configuration.md#row-format-table-mode)). If the serialized payload exceeds the size
cap it is truncated with `truncated: true, returnedRows: <n>` — see
[response safety](security.md#response-safety).

```json
// query { "database": "main_pg", "sql": "SELECT id, name FROM users ORDER BY id", "maxRows": 2 }
{ "success": true, "rows": [{ "id": 1, "name": "Ann" }, { "id": 2, "name": "Bob" }], "count": 2, "database": "main_pg" }
```

A write keyword or dangerous function returns `{ success: false, error, code: "READONLY_VIOLATION" }`.

## list_databases

No parameters. Always registered globally (even in per-database mode).

Output: `{ success: true, data: [{ id, type, description }] }`.

```json
{ "success": true, "data": [
  { "id": "main_pg", "type": "postgresql", "description": "Main PostgreSQL" },
  { "id": "analytics", "type": "clickhouse", "description": "ClickHouse analytics" }
] }
```

## list_tables

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `schema` | string | no | Schema (default `public` for PostgreSQL; ignored for ClickHouse) |

Output: `{ success: true, data: [{ schema, name, type }], database }` where `type` is `"table"` or `"view"`.

```json
{ "success": true, "data": [{ "schema": "public", "name": "users", "type": "table" }], "database": "main_pg" }
```

## describe_table

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `table` | string | yes | Table name |
| `schema` | string | no | Schema (default `public` for PostgreSQL; ignored for ClickHouse) |

Output: `{ success: true, data: [{ name, type, nullable, defaultValue, isPrimaryKey }], database }`.

```json
{ "success": true, "data": [
  { "name": "id", "type": "integer", "nullable": false, "defaultValue": "nextval('users_id_seq')", "isPrimaryKey": true },
  { "name": "name", "type": "text", "nullable": true, "defaultValue": null, "isPrimaryKey": false }
], "database": "main_pg" }
```

## schema

Full DDL for a schema (PostgreSQL: `CREATE TABLE` reconstructed from `information_schema`;
ClickHouse: `create_table_query` from `system.tables`).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `schema` | string | no | Schema (default `public` for PostgreSQL; ignored for ClickHouse) |

Output: `{ success: true, data: "<DDL string>", database }`.

## explain_query

`EXPLAIN` (or `EXPLAIN ANALYZE`). SQL runs through the same read-only validator as `query`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `sql` | string | yes | Query to explain |
| `analyze` | boolean | no | Run `EXPLAIN ANALYZE`, which **actually executes** the query (still inside a PostgreSQL `READ ONLY` transaction). Default `false` |

Output: `{ success: true, data: "<plan string>", database }`.

## performance

Reads in-memory slow-query metrics. Uses fuzzy id resolution but **not** a live connection, so it
works even when the target database is down or unconnected. The tracker records any query slower
than the threshold (default 1000 ms), keeping the last 100.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `action` | `"getSlowQueries"` \| `"getMetrics"` \| `"reset"` \| `"setThreshold"` | yes | What to do |
| `threshold` | number (ms) | for `setThreshold` | New slow-query threshold |
| `limit` | number | for `getSlowQueries` | Max results (default 20) |

Output by action:

- `getSlowQueries` → `{ data: [{ sql, duration, timestamp, database }], database }`
- `getMetrics` → `{ data: { slowQueryThreshold, connectedDatabases }, database }`
- `reset` → `{ data: "Performance metrics reset" }`
- `setThreshold` → `{ data: "Threshold set to <n>ms" }` (missing `threshold` → error)

## execute

Write statement (`INSERT`/`UPDATE`/`DELETE`/DDL/…). **Not** gated by the read-only validator — this
is the intentional write path.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `statement` | string | yes | SQL to execute |
| `params` | string[] | no | Bound parameters (`$1`, `$2`, … in PostgreSQL). **Ignored by ClickHouse** — use native `{name:Type}` syntax |

Output: `{ success: true, rows, count, database }`. `count` is the driver's affected/returned row
count. Returned `rows` (e.g. from `RETURNING`) are capped at the database's `maxRows`; if capped,
`truncatedAt: <maxRows>` is added. ClickHouse `execute` returns no rows (`rows: []`).

```json
// execute { "database": "main_pg", "statement": "UPDATE users SET name = $1 WHERE id = $2", "params": ["Ann", "1"] }
{ "success": true, "rows": [], "count": 1, "database": "main_pg" }
```

## transaction

Stateful multi-statement transaction (**PostgreSQL only** — ClickHouse `begin` throws
`Transactions are not supported in ClickHouse`). Over HTTP, a transaction lives inside one
stateful session; it is **not available in stateless mode**.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `database` | string | yes | Database id |
| `action` | `"begin"` \| `"execute"` \| `"commit"` \| `"rollback"` | yes | Transaction step |
| `transactionId` | string | for `execute`/`commit`/`rollback` | Id returned by `begin` |
| `statement` | string | for `execute` | SQL to run in the transaction |
| `params` | string[] | for `execute` | Bound parameters (ClickHouse ignores them) |

Output:

- `begin` → `{ data: { transactionId, message: "Transaction started" }, database }`
- `execute` → `{ rows, count, database, truncatedAt? }` (rows capped at `maxRows`, same as `execute`)
- `commit` → `{ data: { message: "Transaction committed" }, database }`
- `rollback` → `{ data: { message: "Transaction rolled back" }, database }`

**Auto-rollback:** an idle transaction is rolled back automatically after **5 minutes** (TTL),
and all open transactions are rolled back on server shutdown. `execute`/`commit`/`rollback`
against an unknown or already-finalized id return `code: "TX_NOT_FOUND"`.

---

## Error codes

Errors are `{ success: false, error: "<message>", code?: "<CODE>" }` (with `isError: true` at the
MCP layer). Coded errors:

| Code | Raised by | Meaning |
|------|-----------|---------|
| `READONLY_VIOLATION` | `query`, `explain_query` | SQL contained a write keyword, a denied function, or multiple statements — see [security](security.md) |
| `DB_NOT_FOUND` | any tool | `database` matched no configured id |
| `DB_AMBIGUOUS` | any tool | `database` fuzzily matched more than one id |
| `TX_NOT_FOUND` | `transaction` | `transactionId` is unknown or already finalized |

Other failures (a missing required param, a driver/connection error) return an `error` message
with no `code`.

## Truncation fields

Two independent caps can appear in responses:

| Field | Set by | Meaning |
|-------|--------|---------|
| `truncated` + `returnedRows` | `query` | Serialized payload exceeded the 1 M-char cap; rows were halved until it fit ([details](security.md#response-safety)) |
| `truncatedAt` | `execute`, `transaction execute` | Returned rows exceeded the database's `maxRows`; sliced to that many (`count` still reports the true total) |

## ClickHouse notes

- **No transactions** — `transaction begin` throws.
- **`params` ignored** in `query`/`execute`/`transaction execute` — use ClickHouse native
  `{name:Type}` parameter syntax inside the SQL instead.
- `schema` is ignored for `list_tables`/`describe_table`/`schema` (ClickHouse queries
  `currentDatabase()`).

## Per-database tool mode

With `"toolsPerDatabase": true`, tools are registered once per database with the id baked into the
name and no `database` parameter:

```
query_main_pg, list_tables_main_pg, describe_table_main_pg, schema_main_pg,
explain_query_main_pg, performance_main_pg, execute_main_pg, transaction_main_pg,
query_analytics, ...
list_databases   (always global)
```

Each tool's description includes the database `description` if set. Everything else — params,
output, error codes — is identical to the parameter-mode tools above, minus `database`.
