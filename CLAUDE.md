# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MCP server exposing read/write access to PostgreSQL and ClickHouse over stdio (IDE) and HTTP (remote) transports. TypeScript, ESM, Node 20/22.

## Commands

All runtime commands **require** a `--config <path>` arg or they throw:
- Dev (no build): `npm run dev -- --config config.json`
- Start (built): `npm start -- --config config.json`
- Build: `npm run build` (`tsc`)
- Test: `npm test` — all connectors/tools are mocked, no live DB needed
- Single file: `npx vitest run tests/tools/query.test.ts` · by name: `npx vitest run -t "substring"`
- Coverage: `npm run test:coverage` — thresholds enforced (lines/functions/statements 90, branches 85); CI fails below.
- Lint/format: `npm run lint`, `npm run format`. Typecheck: `npx tsc --noEmit`.

CI runs build → lint → `format:check` → `tsc --noEmit` → `test:coverage`. Lefthook pre-commit already runs biome + tsc on staged `*.ts`.

## Style (Biome, differs from defaults)

2-space indent, line width 120, double quotes, always semicolons, trailing commas everywhere. Non-null `!` allowed (`noNonNullAssertion` off). `${VAR}` string literals allowed (`noTemplateCurlyInString` off — needed for env substitution).

## Adding an MCP tool

1. New file in `src/tools/readonly/` or `write/` exporting `create<Name>Params(dbIds)` (Zod raw-shape) and `<name>Handler(manager)` (`async (params) => {...}`).
2. Resolve db via `manager.acquire(params.database)` (fuzzy id + lazy connect); return through `formatRows`/`formatError`/`formatCaughtError` from `utils/response.ts`.
3. Read-only tools must gate SQL through `validateReadonlySql` (`utils/sql-validator.ts`) first.
4. Register in `src/tools/registry.ts` in **both** `registerParameterTools` and `registerPerDatabaseTools` (per-db mode injects `{ database: dbId, ...params }`).

## Gotchas

- Config is a JSON file, not env vars. Any `${VAR}` inside it is substituted recursively before Zod validation; a missing env var throws immediately (`src/config/loader.ts`).
- `validateReadonlySql` uses one dialect-agnostic denylist (write keywords + dangerous funcs like `pg_sleep`, CH table functions) — a column literally named e.g. `url` can false-positive.
- `query.maxRows` only lowers the configured cap, never raises it.
- Connections are lazy (`manager.acquire`); config hot-reloads via `fs.watch` and reconnects changed dbs mid-run.
- ClickHouse: no transactions (throws); use native `{name:Type}` param syntax. Transactions are PostgreSQL-only and stateful (same HTTP session).
- HTTP transport: bearer auth optional, `/health` unprotected.
