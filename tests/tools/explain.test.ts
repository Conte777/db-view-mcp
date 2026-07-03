import { describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { Connector } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { explainHandler } from "../../src/tools/readonly/explain.js";

type ManagerWithCreateConnector = { createConnector: (config: ResolvedDatabaseConfig) => Connector };

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

function fakeConnector(overrides: Partial<Connector>): Connector {
  return {
    type: "postgresql",
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    execute: vi.fn(),
    listTables: vi.fn(),
    describeTable: vi.fn(),
    getSchema: vi.fn(),
    explain: vi.fn(),
    beginTransaction: vi.fn(),
    ...overrides,
  };
}

function managerWith(overrides: Partial<Connector>) {
  const manager = new ConnectorManager(configs);
  (manager as unknown as ManagerWithCreateConnector).createConnector = () => fakeConnector(overrides);
  return manager;
}

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("explainHandler", () => {
  it("rejects a write statement with READONLY_VIOLATION before touching the connector", async () => {
    const explain = vi.fn();
    const body = parse(await explainHandler(managerWith({ explain }))({ database: "pg", sql: "DELETE FROM t" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("READONLY_VIOLATION");
    expect(explain).not.toHaveBeenCalled();
  });

  it("forwards normalized sql and defaults analyze to false", async () => {
    const explain = vi.fn().mockResolvedValue({ plan: "Seq Scan on t" });
    const body = parse(await explainHandler(managerWith({ explain }))({ database: "pg", sql: "SELECT 1; -- c" }));
    expect(explain).toHaveBeenCalledWith("SELECT 1", false);
    expect(body.success).toBe(true);
    expect(body.database).toBe("pg");
    expect(body.data).toBe("Seq Scan on t");
  });

  it("passes analyze through when set", async () => {
    const explain = vi.fn().mockResolvedValue({ plan: "p" });
    await explainHandler(managerWith({ explain }))({ database: "pg", sql: "SELECT 1", analyze: true });
    expect(explain).toHaveBeenCalledWith("SELECT 1", true);
  });

  it("surfaces DB_NOT_FOUND for an unknown database", async () => {
    const body = parse(await explainHandler(managerWith({}))({ database: "nope", sql: "SELECT 1" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("DB_NOT_FOUND");
  });
});
