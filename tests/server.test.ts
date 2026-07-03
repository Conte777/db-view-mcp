import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/types.js";
import { createConnectorManager, createMcpServerInstance, createServer } from "../src/server.js";
import { formatSuccess, setRowFormat } from "../src/utils/response.js";

function baseConfig(rowFormat: "json" | "table" = "json"): AppConfig {
  return {
    transport: { type: "stdio" },
    defaults: {
      maxRows: 100,
      lazyConnection: true,
      toolsPerDatabase: false,
      queryTimeout: 30000,
      logLevel: "info",
      rowFormat,
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

afterEach(() => {
  setRowFormat("json"); // reset the response module singleton
});

describe("createConnectorManager", () => {
  it("builds a manager exposing the configured database ids", () => {
    expect(createConnectorManager(baseConfig()).getDatabaseIds()).toEqual(["pg"]);
  });
});

describe("createMcpServerInstance", () => {
  it("applies rowFormat from config defaults as an observable side effect", () => {
    const manager = createConnectorManager(baseConfig("table"));
    createMcpServerInstance(manager, baseConfig("table"));
    const out = JSON.parse(formatSuccess({ rows: [{ a: 1 }] }).content[0].text);
    expect(out.rowsTable).toBeDefined();
    expect(out.rows).toBeUndefined();
  });
});

describe("createServer", () => {
  it("returns a server and manager and connects eagerly (no-op for lazy dbs)", async () => {
    const { server, manager } = await createServer(baseConfig());
    expect(manager.getDatabaseIds()).toEqual(["pg"]);
    expect(server).toBeDefined();
  });
});
