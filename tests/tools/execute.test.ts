import { describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { Connector, QueryResult } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { executeHandler } from "../../src/tools/write/execute.js";

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
    maxRows: 2,
    queryTimeout: 30000,
  },
];

function managerWith(execute: Connector["execute"]) {
  const manager = new ConnectorManager(configs);
  (manager as unknown as ManagerWithCreateConnector).createConnector = () => ({
    type: "postgresql",
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    execute,
    listTables: vi.fn(),
    describeTable: vi.fn(),
    getSchema: vi.fn(),
    explain: vi.fn(),
    beginTransaction: vi.fn(),
  });
  return manager;
}

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("executeHandler", () => {
  it("caps RETURNING rows to the configured maxRows and reports truncatedAt", async () => {
    const result: QueryResult = { rows: [{ a: 1 }, { a: 2 }, { a: 3 }], rowCount: 3 };
    const handler = executeHandler(managerWith(vi.fn().mockResolvedValue(result)));
    const body = parse(await handler({ database: "pg", statement: "UPDATE t SET a=a RETURNING a" }));
    expect(body.rows).toHaveLength(2);
    expect(body.count).toBe(3);
    expect(body.truncatedAt).toBe(2);
  });

  it("sanitizes oversized/binary cells in RETURNING rows", async () => {
    const buf = Buffer.from([0x01, 0x02, 0x03]);
    const result: QueryResult = { rows: [{ blob: buf }], rowCount: 1 };
    const handler = executeHandler(managerWith(vi.fn().mockResolvedValue(result)));
    const body = parse(await handler({ database: "pg", statement: "UPDATE t SET blob=$1 RETURNING blob" }));
    expect(body.rows[0].blob).toBe("<binary 3 bytes: 010203...>");
  });

  it("surfaces DB_NOT_FOUND for an unknown database", async () => {
    const handler = executeHandler(managerWith(vi.fn()));
    const body = parse(await handler({ database: "nope", statement: "SELECT 1" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("DB_NOT_FOUND");
  });
});
