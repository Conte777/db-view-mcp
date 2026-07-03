# Architecture

TypeScript, ESM, Node 20/22. A thin request path (MCP tool → connector → database) with a
connector layer that handles pooling, instrumentation, and hot-reloadable config.

Source of truth: `src/index.ts`, `src/server.ts`, `src/connectors/*`.

## Source tree

```
src/
├── index.ts              Entry point: CLI args → config → transport routing → shutdown & hot-reload
├── server.ts             Builds McpServer + ConnectorManager, registers tools, sets rowFormat
├── config/
│   ├── types.ts          Zod schemas (transport, defaults, databases) + resolveDbConfig
│   └── loader.ts         Reads config file, ${ENV} substitution, parses CLI args
├── connectors/
│   ├── interface.ts      Connector / TransactionHandle / QueryResult contracts
│   ├── manager.ts        ConnectorManager: lazy connect, dedup, hot-reload diff
│   ├── instrumented.ts   InstrumentedConnector: perf-timing decorator
│   ├── postgresql.ts     pg Pool connector
│   └── clickhouse.ts     @clickhouse/client connector
├── tools/
│   ├── registry.ts       Registers tools (parameter mode vs per-database mode)
│   ├── readonly/         query, list-tables, describe-table, schema, explain, performance, list-databases
│   └── write/            execute, transaction (+ TransactionStore)
├── transport/
│   └── http.ts           Express app: sessions, bearer auth, /health
└── utils/
    ├── response.ts       Response formatting, sanitization, size caps, rowFormat
    ├── sql-validator.ts  Read-only SQL validation + query wrapping
    ├── resolve-db.ts     Fuzzy database-id resolution
    └── logger.ts         Leveled logger
```

## Layers and data flow

```
index → server → ConnectorManager → InstrumentedConnector → Postgres/ClickHouse connector → DB
                      ▲                                                          │
                    tools ──────────── utils (response, sql-validator, resolve-db)
```

A tool handler resolves the database via `manager.acquire(id)` (fuzzy id + lazy connect), calls a
`Connector` method, and formats the result through `utils/response.ts`. Read tools validate SQL
through `utils/sql-validator.ts` first.

### Connector interface

`src/connectors/interface.ts` defines the contract both engines implement: `connect`/`disconnect`,
`query`/`execute`, `listTables`/`describeTable`/`getSchema`, `explain`, and `beginTransaction`
(returning a `TransactionHandle` with `execute`/`commit`/`rollback`). PostgreSQL and ClickHouse
each provide one implementation; ClickHouse's `beginTransaction` throws (unsupported).

### InstrumentedConnector

A decorator wrapping the real connector. It times `query`/`execute` and feeds durations to the
`PerformanceTracker` (surfaced by the `performance` tool); all other methods pass straight through.
Every connector handed out by the manager is wrapped, so timing is uniform.

### ConnectorManager

Owns config and live connectors. Key behaviors:

- **Lazy vs eager connect** — databases with `lazyConnection: true` (default) connect on first
  `acquire`; `connectEager()` at startup connects the rest up front.
- **Concurrent-connect dedup** — the in-flight connect promise is stored before awaiting, so
  concurrent callers hitting the same cold database join one connect instead of each opening a pool.
- **Mid-connect config-swap guard** — if a hot-reload replaces or removes a database's config while
  its connection is still opening, the freshly built connector is discarded (rather than pinning the
  manager to superseded, e.g. rotated, credentials) and the caller is asked to retry.
- **Hot-reload diff** — `updateDatabases(newConfigs)` computes added / removed / changed by id
  (change detected via config deep-equality), invalidating and reconnecting only what actually moved.

## Lifecycle

`src/index.ts` wires the runtime concerns:

- **Config hot-reload** — `fs.watch` on the config path, **500 ms debounced**. On change the file is
  re-read, env-substituted, and re-validated, then `ConnectorManager.updateDatabases` applies the
  diff. A failed reload (bad JSON, validation error, missing env var) is logged and the running
  config is kept.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` trigger an idempotent shutdown that closes the transport
  (HTTP server + all sessions, or the stdio server), rolls back open transactions
  (`transactionStore.cleanupAll`), and disconnects all pools. A **10 s** timer force-exits if
  shutdown hangs; a second signal forces exit immediately.
- **Transaction TTL** — open transactions auto-roll-back after 5 min of inactivity (see
  [Tools > transaction](tools.md#transaction)).

## Docker

Multi-stage `Dockerfile`: build stage compiles TypeScript, runtime stage installs prod deps only,
runs as the non-root `node` user, exposes `3000`, and expects the config at `/config/config.json`:

```
ENTRYPOINT ["node", "dist/index.js", "--config", "/config/config.json"]
```

Mount your config (and pass `--transport http` / env vars) at run time.
