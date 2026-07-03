import { describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { Connector } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { schemaHandler } from "../../src/tools/readonly/schema.js";

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

describe("schemaHandler", () => {
  it("forwards the schema and returns DDL with the resolved database id", async () => {
    const getSchema = vi.fn().mockResolvedValue("CREATE TABLE t (...)");
    const body = parse(await schemaHandler(managerWith({ getSchema }))({ database: "pg", schema: "public" }));
    expect(getSchema).toHaveBeenCalledWith("public");
    expect(body.success).toBe(true);
    expect(body.database).toBe("pg");
    expect(body.data).toBe("CREATE TABLE t (...)");
  });

  it("passes undefined schema when omitted", async () => {
    const getSchema = vi.fn().mockResolvedValue("");
    await schemaHandler(managerWith({ getSchema }))({ database: "pg" });
    expect(getSchema).toHaveBeenCalledWith(undefined);
  });

  it("surfaces DB_NOT_FOUND for an unknown database", async () => {
    const body = parse(await schemaHandler(managerWith({}))({ database: "nope" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("DB_NOT_FOUND");
  });
});
