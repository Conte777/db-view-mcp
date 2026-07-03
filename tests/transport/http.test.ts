import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, HttpTransportConfig } from "../../src/config/types.js";
import { startHttpTransport } from "../../src/transport/http.js";
import { getLogger } from "../../src/utils/logger.js";

function baseConfig(): AppConfig {
  return {
    transport: { type: "http", port: 0, host: "127.0.0.1", stateless: false, sessionTimeout: 30 * 60 * 1000 },
    defaults: {
      maxRows: 100,
      lazyConnection: true,
      toolsPerDatabase: false,
      queryTimeout: 30000,
      logLevel: "info",
      rowFormat: "json",
    },
    databases: [
      {
        id: "pg",
        type: "postgresql",
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "",
        sslRejectUnauthorized: true,
        lazyConnection: true,
        maxRows: 100,
        queryTimeout: 30000,
      },
    ],
  };
}

let running: Awaited<ReturnType<typeof startHttpTransport>> | undefined;

async function start(config: AppConfig): Promise<string> {
  running = await startHttpTransport(config, config.transport as HttpTransportConfig);
  const { port } = running.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeEach(() => {
  // Silence the transport's stderr logging; individual tests spy on logger methods explicitly.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  if (running) {
    if (running.cleanupInterval) clearInterval(running.cleanupInterval);
    await new Promise<void>((resolve) => running!.httpServer.close(() => resolve()));
    running = undefined;
  }
  vi.restoreAllMocks();
});

const rpcHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

describe("/health", () => {
  it("returns full status without auth", async () => {
    const url = await start(baseConfig());
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", activeSessions: 0, databases: ["pg"] });
  });

  it("returns only { status: ok } for a wrong token when auth is configured", async () => {
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).auth = { type: "bearer", token: "secret" };
    const url = await start(cfg);
    const res = await fetch(`${url}/health`, { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns full status for the correct token", async () => {
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).auth = { type: "bearer", token: "secret" };
    const url = await start(cfg);
    const res = await fetch(`${url}/health`, { headers: { authorization: "Bearer secret" } });
    const body = await res.json();
    expect(body.activeSessions).toBe(0);
    expect(body.databases).toEqual(["pg"]);
  });
});

describe("/mcp auth middleware", () => {
  it("rejects missing and wrong bearer with 401", async () => {
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).auth = { type: "bearer", token: "secret" };
    const url = await start(cfg);
    const noAuth = await fetch(`${url}/mcp`, { method: "POST", headers: rpcHeaders, body: "{}" });
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...rpcHeaders, authorization: "Bearer nope" },
      body: "{}",
    });
    expect(wrong.status).toBe(401);
  });

  it("lets the correct bearer through the middleware", async () => {
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).auth = { type: "bearer", token: "secret" };
    const url = await start(cfg);
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...rpcHeaders, authorization: "Bearer secret" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).not.toBe(401);
  });
});

describe("stateful /mcp", () => {
  it("returns 404 for an unknown session id", async () => {
    const url = await start(baseConfig());
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...rpcHeaders, "mcp-session-id": "does-not-exist" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Session not found");
  });
});

describe("stateless /mcp", () => {
  it("handles a request through a per-request server", async () => {
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).stateless = true;
    const url = await start(cfg);
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: rpcHeaders, body: "{}" });
    // The per-request server/transport pair is created, handles the (invalid) body and is torn down.
    expect(res.status).toBeLessThan(500);
    await res.text();
  });
});

describe("non-loopback binding", () => {
  it("warns when bound to a non-loopback host without auth", async () => {
    const warnSpy = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const cfg = baseConfig();
    (cfg.transport as HttpTransportConfig).host = "0.0.0.0";
    await start(cfg);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("non-loopback");
  });
});
