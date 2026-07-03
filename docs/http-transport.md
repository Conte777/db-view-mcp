# Transports

Two transports, chosen by `transport.type` in the config (or the `--transport stdio|http` CLI
flag, which overrides it).

Source of truth: `src/transport/http.ts`, `src/index.ts`.

## stdio (default)

Communication over stdin/stdout. Best for local IDE integrations where the MCP client spawns the
server process (Cursor, Claude Code, Claude Desktop). One `McpServer` instance, no network. See
the [README](../README.md#3-add-an-mcp-client) for client wiring.

## HTTP

MCP Streamable HTTP transport. Best for remote access, multiple simultaneous clients, and web
integrations. Configure it under `transport` (see [Configuration](configuration.md#transport)):

```json
{
  "transport": {
    "type": "http",
    "port": 3000,
    "host": "127.0.0.1",
    "stateless": false,
    "auth": { "type": "bearer", "token": "your-secret-token" }
  }
}
```

Database connection pools are shared across all sessions/requests.

### Endpoints

| Method(s) | Path | Description |
|-----------|------|-------------|
| `POST` / `GET` / `DELETE` | `/mcp` | MCP messages (auth-protected when `auth` is set) |
| `GET` | `/health` | Liveness + status; unprotected (see below) |

### Stateful vs stateless

**Stateful** (default): the first request without an `Mcp-Session-Id` initializes a session — a
dedicated `McpServer` instance and a session id returned in the `Mcp-Session-Id` response header.
Subsequent requests carry that header. A request with an *unknown* session id gets `404 Session
not found`. Sessions support cross-request state, notably [transactions](tools.md#transaction).
Idle sessions are cleaned up (see below).

**Stateless** (`"stateless": true`): no session management. Each request gets a throwaway
`McpServer` that is closed after the response. No `Mcp-Session-Id`, and **no transactions** (a
`transaction begin` has nowhere to live across requests).

### Session lifecycle

- `sessionTimeout` (default **30 min**) bounds how long a session may sit idle.
- A sweep runs every **60 s** and closes sessions whose last access is older than `sessionTimeout`.
- Each request refreshes the session's last-accessed time.
- On shutdown all sessions are closed (see [Architecture > lifecycle](architecture.md#lifecycle)).

### Authentication

Optional bearer token. When `transport.auth` is set, every `/mcp` request must send
`Authorization: Bearer <token>`; anything else gets `401 Unauthorized`. The comparison is
**timing-safe** (constant-time, length-checked) to avoid leaking the token byte by byte.

`/health` is **never** 401'd, but it is auth-aware: with auth configured, an unauthenticated
request gets a reduced body (`{ "status": "ok" }` only), while an authenticated one (or any
request when no auth is set) gets the full status:

```json
{ "status": "ok", "activeSessions": 2, "databases": ["main_pg", "analytics"] }
```

### Non-loopback warning

Binding a non-loopback `host` (anything other than `127.0.0.1`, `::1`, `localhost`) **without**
`auth` logs a warning at startup — the server is then reachable from the network with no
authentication. Set `transport.auth` or bind to loopback. See [Security](security.md#network-exposure).

### curl examples

Initialize a session (stateful mode):

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

The response includes an `Mcp-Session-Id` header. Reuse it:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer your-secret-token" \
  -H "Mcp-Session-Id: <session-id-from-init>" \
  -d '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }'
```

Health check (no auth header needed for liveness):

```bash
curl http://localhost:3000/health
```
