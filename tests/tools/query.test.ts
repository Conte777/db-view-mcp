import { describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { Connector, QueryResult } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { queryToolHandler } from "../../src/tools/readonly/query.js";

// Structural cast target: createConnector is private on ConnectorManager,
// so intersecting with the class would reduce to never.
type ManagerWithCreateConnector = {
  createConnector: (config: ResolvedDatabaseConfig) => Connector;
};

const configs: ResolvedDatabaseConfig[] = [
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
];

function fakeConnector(query: Connector["query"]): Connector {
  return {
    type: "postgresql",
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    query,
    execute: vi.fn(),
    listTables: vi.fn(),
    describeTable: vi.fn(),
    getSchema: vi.fn(),
    explain: vi.fn(),
    beginTransaction: vi.fn(),
  };
}

function managerWith(query: Connector["query"]) {
  const manager = new ConnectorManager(configs);
  (manager as unknown as ManagerWithCreateConnector).createConnector = () => fakeConnector(query);
  return manager;
}

const emptyResult: QueryResult = { rows: [], rowCount: 0 };

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("queryToolHandler maxRows clamp", () => {
  it("clamps a request above the configured cap down to the cap", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    await handler({ database: "pg", sql: "SELECT 1", maxRows: 5000 });
    expect(query).toHaveBeenCalledWith("SELECT 1", undefined, 100);
  });

  it("honors a request below the cap", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    await handler({ database: "pg", sql: "SELECT 1", maxRows: 10 });
    expect(query).toHaveBeenCalledWith("SELECT 1", undefined, 10);
  });

  it("falls back to the cap when maxRows is omitted", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    await handler({ database: "pg", sql: "SELECT 1" });
    expect(query).toHaveBeenCalledWith("SELECT 1", undefined, 100);
  });

  it("forwards normalized sql (comment/semicolon stripped) to the connector", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    await handler({ database: "pg", sql: "SELECT 1; -- trailing" });
    expect(query).toHaveBeenCalledWith("SELECT 1", undefined, 100);
  });

  it("rejects a write statement without touching the connector", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    const body = parse(await handler({ database: "pg", sql: "DELETE FROM t" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("READONLY_VIOLATION");
    expect(query).not.toHaveBeenCalled();
  });

  it("surfaces DB_NOT_FOUND for an unknown database", async () => {
    const query = vi.fn().mockResolvedValue(emptyResult);
    const handler = queryToolHandler(managerWith(query));
    const body = parse(await handler({ database: "does-not-exist", sql: "SELECT 1" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("DB_NOT_FOUND");
  });
});
