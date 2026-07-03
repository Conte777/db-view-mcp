# Security

Two layers protect against accidental or malicious damage: a **read-only SQL validator** in front
of the read tools, and **response sanitization / size caps** on everything that comes back. Bearer
auth and loopback binding protect the HTTP surface.

None of this makes the write tools (`execute`, `transaction`) safe — those exist to write. Scope
what the configured database *user* can do at the database level; the validator only guards the
read path.

Source of truth: `src/utils/sql-validator.ts`, `src/utils/response.ts`, `src/transport/http.ts`.

## Read-only SQL validator

`query` and `explain_query` run their SQL through `validateReadonlySql` before it reaches a
connector. It normalizes the SQL (strips string literals to inert placeholders, strips comments,
collapses whitespace) and then rejects the statement if any check below fails.

### Write-keyword deny-list

Rejected if any of these appear as a whole word (case-insensitive), *anywhere* in the normalized
SQL — so a write hidden inside a CTE (`WITH x AS (DELETE …)`) or a subquery is still caught:

```
INSERT  UPDATE  DELETE  DROP  ALTER  TRUNCATE
CREATE  GRANT  REVOKE  REPLACE  MERGE  COPY  CALL
```

### Dangerous-function deny-list

Rejected if invoked as a **function call** (name directly followed by `(`), so a column or table
merely *named* `url` or `file_uploads` is left alone. One dialect-agnostic list covers both engines:

*PostgreSQL — admin / superuser, filesystem, cross-server, DoS:*

```
pg_terminate_backend  pg_cancel_backend  pg_reload_conf
pg_read_file  pg_read_binary_file  pg_stat_file
pg_ls_dir  pg_ls_logdir  pg_ls_waldir  pg_ls_tmpdir  pg_ls_archive_statusdir
pg_file_write  pg_file_rename  pg_file_unlink  lo_import  lo_export
dblink  dblink_exec  dblink_connect  dblink_connect_u
dblink_send_query  dblink_open  dblink_fetch  dblink_close
pg_sleep  pg_logical_emit_message  pg_create_restore_point
pg_switch_wal  pg_promote  set_config
```

*ClickHouse — table functions that reach outside the database (SSRF / exfiltration):*

```
url  file  s3  remote  remoteSecure  mysql  postgresql
jdbc  odbc  hdfs  azureBlobStorage  executable
```

### Bypass protections

The normalization is built to close the usual evasions:

- **Comment-hidden writes** — block (`/* */`) and line (`--`) comments are stripped before matching,
  so `SELECT 1 -- \nDROP TABLE t` is caught.
- **CTE- or subquery-wrapped writes** — the keyword match scans the whole statement, not just the
  leading verb.
- **Multiple statements** — a `;` followed by more SQL is rejected outright (`Multiple statements
  are not allowed`). String literals are removed first, so a `;` *inside* a string doesn't
  false-positive.
- **Quoted-identifier tricks** — double-quoted identifiers are unwrapped (not blanked) before
  matching, because in PostgreSQL/ClickHouse `"pg_terminate_backend"(1)` invokes the same function
  as the unquoted form. Failing safe here can at worst reject a benign read whose column happens to
  equal a denied name.

### What actually runs

On success the validator returns `normalizedSql` — the original SQL with comments and trailing
semicolons removed but **string/identifier content byte-for-byte intact** (the placeholder text
used for keyword matching never reaches the database). That is wrapped as:

```sql
SELECT * FROM (<normalizedSql>) AS _q LIMIT <n>
```

and, as defense-in-depth beyond the validator:

- **PostgreSQL** runs it (and `EXPLAIN ANALYZE`) inside a `BEGIN TRANSACTION READ ONLY`, which
  blocks writes at the server even if a keyword slipped through.
- **ClickHouse** runs it with `readonly: "1"`, which reliably blocks writes and settings changes.

## Response safety

Every row payload is sanitized and size-capped before it leaves the server — applied to write
results too, since a `RETURNING` clause can surface attacker-influenced data.

| Cap | Value | Behavior |
|-----|-------|----------|
| Per-cell string | 10 000 chars | Oversized strings truncated to `"<first 10k>... [truncated, N chars total]"` |
| Binary cell | 16-byte preview | `Buffer`/`Uint8Array` rendered as `<binary N bytes: <hex>...>` (raw bytes never serialized) |
| Total payload | 1 000 000 chars | If the serialized JSON exceeds this and carries rows, the row count is **halved repeatedly** until it fits; response then carries `truncated: true, returnedRows: <n>` |

The per-cell and payload caps apply in both `json` and `table`
[row formats](configuration.md#row-format-table-mode).

## maxRows clamp

The `query` tool's `maxRows` parameter can only **lower** the configured cap, never raise it
(`min(requested, configured)`). `execute`/`transaction execute` slice returned rows to the
configured `maxRows` and flag it with `truncatedAt`. See [Truncation fields](tools.md#truncation-fields).

## Network exposure

- **Bearer auth** — optional but strongly recommended for any non-loopback bind. Token comparison
  is constant-time; a wrong or missing token on `/mcp` returns `401`. See
  [Transports > authentication](http-transport.md#authentication).
- **Bind to loopback** — the default `host` is `127.0.0.1`. Binding a non-loopback host *without*
  auth logs a startup warning; don't ignore it. Put the server behind auth or a trusted network
  boundary before exposing it.
- `/health` is unprotected but returns only `{ "status": "ok" }` to unauthenticated callers when
  auth is configured, so it doesn't leak the session count or database ids.
