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
    await expect(
      manager.withConnector("unknown", async () => {})
    ).rejects.toThrow("Unknown database: unknown");
  });
});
