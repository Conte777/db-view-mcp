# Configuration

db-view-mcp is configured with a single JSON file passed via `--config <path>` (required —
the server throws without it). There are no environment-variable-only settings; env vars are
only referenced *from inside* the config (see [Environment variable substitution](#environment-variable-substitution)).

Start from [`config.example.json`](../config.example.json):

```bash
cp config.example.json config.json
```

Top-level shape:

```json
{
  "transport": { ... },   // optional, defaults to stdio
  "defaults":  { ... },   // optional, all fields defaulted
  "databases": [ ... ]    // required, at least one entry
}
```

Source of truth: `src/config/types.ts`, `src/config/loader.ts`.

## Transport

Optional. When omitted, stdio is used. A `--transport stdio|http` CLI flag overrides
`transport.type` from the file. See [HTTP transport](http-transport.md) for the runtime details.

`type: "stdio"` takes no other fields.

`type: "http"`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"http"` | — | Selects HTTP transport |
| `port` | number | `3000` | Listen port |
| `host` | string | `"127.0.0.1"` | Bind address. Binding a non-loopback host with no `auth` logs a warning |
| `stateless` | boolean | `false` | Disable session management (each request independent, no cross-request transactions) |
| `sessionTimeout` | number | `1800000` (30 min) | Idle session TTL in ms; a 60 s sweep closes sessions idle longer than this. Stateful mode only |
| `auth.type` | `"bearer"` | — | Only bearer is supported |
| `auth.token` | string | — | Token value; clients send `Authorization: Bearer <token>` |

`auth` is optional; when present, both `type` and `token` are required.

## Defaults

Optional; every field has a default. Per-database overrides win over these (see the database tables below).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRows` | number (positive int) | `100` | Row cap for `query`; also caps rows returned by `execute`/`transaction execute` |
| `lazyConnection` | boolean | `true` | Connect on first use instead of at startup |
| `toolsPerDatabase` | boolean | `false` | Register a separate tool per database (`query_<id>`, …) instead of one tool with a `database` param |
| `queryTimeout` | number (ms) | `30000` | Query/statement timeout |
| `logLevel` | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | `"info"` | Log verbosity |
| `rowFormat` | `"json"` \| `"table"` | `"json"` | Row rendering; see [Row format](#row-format-table-mode) |

## PostgreSQL database

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | yes | — | Unique identifier |
| `type` | yes | — | Must be `"postgresql"` |
| `connectionString` | no\* | — | Full connection URI; alternative to `host` + `database` + `user` |
| `host` | no\* | — | Hostname |
| `port` | no | `5432` | Port |
| `database` | no\* | — | Database name |
| `user` | no\* | — | Username |
| `password` | no | `""` | Password |
| `ssl` | no | — | Enable SSL |
| `sslCa` | no | — | CA certificate — **either a filesystem path or an inline PEM** (a value starting with `-----BEGIN` is used verbatim, otherwise read as a file) |
| `sslRejectUnauthorized` | no | `true` | Verify the server certificate |
| `description` | no | — | Human-readable label (shown in `list_databases` and per-database tool descriptions) |
| `lazyConnection` | no | inherits `defaults` | Override |
| `maxRows` | no | inherits `defaults` | Override |
| `queryTimeout` | no | inherits `defaults` | Override |

\* Either `connectionString`, **or** `host` + `database` + `user` together, must be provided.

The connection pool is fixed at `max: 10`; `queryTimeout` is applied as both the pg client-side
`query_timeout` and the server-side `statement_timeout`.

## ClickHouse database

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | yes | — | Unique identifier |
| `type` | yes | — | Must be `"clickhouse"` |
| `url` | yes | — | HTTP(S) URL, e.g. `http://localhost:8123` or `https://host:8443` |
| `database` | yes | — | Database name |
| `user` | no | `"default"` | Username |
| `password` | no | `""` | Password |
| `tls.ca` | no | — | CA certificate — path or inline PEM (same rule as PostgreSQL `sslCa`). TLS is only configured when `tls.ca` is set |
| `tls.rejectUnauthorized` | no | `true` | Verify the server certificate |
| `description` | no | — | Human-readable label |
| `lazyConnection` | no | inherits `defaults` | Override |
| `maxRows` | no | inherits `defaults` | Override |
| `queryTimeout` | no | inherits `defaults` | Override (applied as the client `request_timeout`) |

See [ClickHouse limitations](tools.md#clickhouse-notes) for transaction/param caveats.

## Per-database tool mode

Set `"toolsPerDatabase": true` in `defaults` to register a separate tool per database instead
of a single tool with a `database` parameter: `query_main_pg`, `list_tables_main_pg`,
`query_analytics`, etc. Each database's `description` is appended to its tool descriptions.
`list_databases` stays global. Useful when many databases are connected and you want to avoid
picking the wrong `database` argument. See [Tools](tools.md#per-database-tool-mode).

## Row format (table mode)

Set `"rowFormat": "table"` in `defaults` to shrink row payloads for LLM consumption. Instead of a
JSON `rows` array, responses carry a `rowsTable` string: a header line of column names, then one
line per row, cells joined by `|`.

```
// rowFormat: "json" (default)
{ "success": true, "rows": [{ "id": 1, "name": "Ann" }], "count": 1 }

// rowFormat: "table"
{ "success": true, "rowsTable": "id|name\n1|Ann", "count": 1 }
```

Cell encoding (before escaping):

| Value | Rendered as |
|-------|-------------|
| `null` / `undefined` | `NULL` |
| non-finite number (`NaN`, `Infinity`) | `NULL` (mirrors JSON mode) |
| the literal string `"NULL"` | `"NULL"` (quoted, to disambiguate from a real null) |
| empty string | empty cell |
| number / boolean / bigint | `String(value)` |
| `Date` | ISO 8601 |
| object / array | compact `JSON.stringify` |
| other string | verbatim |

Then escaped, in this order: `\` → `\\`, `|` → `\|`, newline → `\n`, carriage return → `\r`.
Genuine string cells additionally escape `"` → `\"`, so a string that looks like the quoted-`NULL`
marker or a serialized object stays distinguishable from the real thing. Column names in the header
are escaped the same way. Payloads over the size cap are truncated the same as JSON mode (fewer
rows, `truncated: true`, `returnedRows` set) — see [security > response safety](security.md#response-safety).

## Environment variable substitution

Any string value in the config may reference an environment variable with `${VAR_NAME}`.
Substitution runs recursively over the whole parsed JSON (strings, arrays, nested objects)
*before* validation, and a single string may contain multiple `${...}` placeholders:

```json
{
  "databases": [
    {
      "id": "main_pg",
      "type": "postgresql",
      "connectionString": "postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:5432/myapp"
    }
  ]
}
```

If a referenced variable is not set, config loading **fails immediately** with an error naming the
missing variable — there is no silent fallback to an empty string or to the literal placeholder.

## Hot reload

The config file is watched at runtime. On change (500 ms debounce) it is re-read and re-validated;
added databases are registered, removed ones disconnected, and changed ones reconnected mid-run
without a restart. A failed reload (bad JSON, validation error, missing env var) is logged and the
previous config keeps running. See [Architecture > lifecycle](architecture.md#lifecycle).
