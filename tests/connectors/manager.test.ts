import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { Connector } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";

// Not an intersection with ConnectorManager: createConnector is private there,
// and intersecting a private member reduces the type to never.
type ManagerWithCreateConnector = {
  createConnector: (config: ResolvedDatabaseConfig) => Connector;
};

function makeFakeConnector(overrides: Partial<Connector> = {}): Connector {
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

// We can't easily test real connectors, so we test config/lookup logic
const mockConfigs: ResolvedDatabaseConfig[] = [
  {
    id: "test_pg",
    type: "postgresql",
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "user",
    password: "pass",
    sslRejectUnauthorized: true,
    lazyConnection: true,
    maxRows: 100,
    queryTimeout: 30000,
  },
  {
    id: "test_ch",
    type: "clickhouse",
    url: "http://localhost:8123",
    database: "default",
    user: "default",
    password: "",
    lazyConnection: true,
    maxRows: 100,
    queryTimeout: 30000,
  },
];

describe("ConnectorManager", () => {
  let manager: ConnectorManager;

  beforeEach(() => {
    manager = new ConnectorManager(mockConfigs);
  });

  it("returns database IDs", () => {
    expect(manager.getDatabaseIds()).toEqual(["test_pg", "test_ch"]);
  });

  it("returns config by ID", () => {
    const config = manager.getConfig("test_pg");
    expect(config).toBeDefined();
    if (config?.type !== "postgresql") throw new Error("expected postgresql config");
    expect(config.host).toBe("localhost");
  });

  it("returns undefined for unknown ID", () => {
    expect(manager.getConfig("unknown")).toBeUndefined();
  });

  it("returns all configs", () => {
    expect(manager.getAllConfigs()).toHaveLength(2);
  });

  it("throws for unknown database on getConnector", async () => {
    await expect(manager.getConnector("unknown")).rejects.toThrow("Unknown database: unknown");
  });

  it("exposes performance tracker", () => {
    const tracker = manager.getPerformanceTracker();
    expect(tracker).toBeDefined();
    expect(typeof tracker.recordQuery).toBe("function");
  });

  it("invalidateConnector does not throw for non-connected db", () => {
    expect(() => manager.invalidateConnector("test_pg")).not.toThrow();
  });
});

describe("ConnectorManager.getConnector concurrency (in-flight connect guard)", () => {
  let manager: ConnectorManager;

  beforeEach(() => {
    manager = new ConnectorManager(mockConfigs);
  });

  it("joins concurrent callers onto a single connect and returns the same instance", async () => {
    let resolveConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const fakeConnector = makeFakeConnector({ connect: vi.fn().mockImplementation(() => connectGate) });
    const createConnector = vi.fn(() => fakeConnector);
    (manager as unknown as ManagerWithCreateConnector).createConnector = createConnector;

    const p1 = manager.getConnector("test_pg");
    const p2 = manager.getConnector("test_pg");

    resolveConnect();
    const [c1, c2] = await Promise.all([p1, p2]);

    expect(createConnector).toHaveBeenCalledOnce();
    expect(c1).toBe(c2);
  });

  it("clears the in-flight entry on a failed connect so the next call retries", async () => {
    const failingConnector = makeFakeConnector({
      connect: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    const succeedingConnector = makeFakeConnector();
    const createConnector = vi.fn().mockReturnValueOnce(failingConnector).mockReturnValueOnce(succeedingConnector);
    (manager as unknown as ManagerWithCreateConnector).createConnector = createConnector;

    await expect(manager.getConnector("test_pg")).rejects.toThrow("connection refused");

    const connector = await manager.getConnector("test_pg");
    expect(connector).toBeDefined();
    expect(createConnector).toHaveBeenCalledTimes(2);
  });

  it("discards a connector whose config was replaced while its connect was in-flight", async () => {
    let resolveConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const stale = makeFakeConnector({ connect: vi.fn().mockImplementation(() => connectGate) });
    const fresh = makeFakeConnector();
    const createConnector = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    (manager as unknown as ManagerWithCreateConnector).createConnector = createConnector;

    const pending = manager.getConnector("test_pg");
    // Hot-reload swaps in a new config object for test_pg mid-connect.
    manager.updateDatabases([{ ...mockConfigs[0], maxRows: 999 }, mockConfigs[1]]);
    resolveConnect();

    await expect(pending).rejects.toThrow(/reconfigured during connection/);
    expect(stale.disconnect).toHaveBeenCalledOnce();

    // The next call builds a brand-new connector from the updated config.
    const connector = await manager.getConnector("test_pg");
    expect(connector).toBeDefined();
    expect(createConnector).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectorManager.acquire", () => {
  let manager: ConnectorManager;

  beforeEach(() => {
    manager = new ConnectorManager(mockConfigs);
  });

  it("resolves a fuzzy id and returns the connector for the resolved id", async () => {
    const fakeConnector = makeFakeConnector();
    (manager as unknown as ManagerWithCreateConnector).createConnector = vi.fn(() => fakeConnector);

    const { id, connector } = await manager.acquire("TEST_PG");

    expect(id).toBe("test_pg");
    expect(connector).toBeDefined();
  });

  it("throws a DB_NOT_FOUND-coded error for an unknown id", async () => {
    await expect(manager.acquire("unknown")).rejects.toMatchObject({ code: "DB_NOT_FOUND" });
  });
});

describe("ConnectorManager.updateDatabases", () => {
  let manager: ConnectorManager;

  beforeEach(() => {
    manager = new ConnectorManager(mockConfigs);
  });

  it("detects added databases", () => {
    const newConfigs: ResolvedDatabaseConfig[] = [
      ...mockConfigs,
      {
        id: "new_pg",
        type: "postgresql",
        host: "newhost",
        port: 5432,
        database: "newdb",
        user: "user",
        password: "",
        sslRejectUnauthorized: true,
        lazyConnection: true,
        maxRows: 100,
        queryTimeout: 30000,
      },
    ];
    const diff = manager.updateDatabases(newConfigs);
    expect(diff.added).toEqual(["new_pg"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(manager.getDatabaseIds()).toContain("new_pg");
  });

  it("detects removed databases", () => {
    const newConfigs: ResolvedDatabaseConfig[] = [mockConfigs[0]];
    const diff = manager.updateDatabases(newConfigs);
    expect(diff.removed).toEqual(["test_ch"]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(manager.getDatabaseIds()).not.toContain("test_ch");
  });

  it("detects changed databases", () => {
    const newConfigs: ResolvedDatabaseConfig[] = [{ ...mockConfigs[0], maxRows: 999 }, mockConfigs[1]];
    const diff = manager.updateDatabases(newConfigs);
    expect(diff.changed).toEqual(["test_pg"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(manager.getConfig("test_pg")!.maxRows).toBe(999);
  });

  it("returns empty diff when nothing changed", () => {
    const diff = manager.updateDatabases(mockConfigs);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});
