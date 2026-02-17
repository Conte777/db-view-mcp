import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectorManager } from "../../src/connectors/manager.js";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";

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
    expect(config!.host).toBe("localhost");
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

  it("withConnector throws for unknown database", async () => {
    await expect(manager.withConnector("unknown", async () => {})).rejects.toThrow("Unknown database: unknown");
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
