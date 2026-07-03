import { describe, expect, it } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { performanceHandler } from "../../src/tools/readonly/performance.js";

const configs: ResolvedDatabaseConfig[] = [
  {
    id: "main_pg",
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

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("performanceHandler", () => {
  it("getSlowQueries returns tracked slow queries for the fuzzily-resolved db", async () => {
    const manager = new ConnectorManager(configs);
    manager.getPerformanceTracker().recordQuery("SELECT slow", 2000, "main_pg");
    const body = parse(await performanceHandler(manager)({ database: "MAIN-PG", action: "getSlowQueries" }));
    expect(body.success).toBe(true);
    expect(body.database).toBe("main_pg");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].sql).toBe("SELECT slow");
  });

  it("getMetrics reports the threshold and database ids", async () => {
    const manager = new ConnectorManager(configs);
    const body = parse(await performanceHandler(manager)({ database: "main_pg", action: "getMetrics" }));
    expect(body.data.slowQueryThreshold).toBe(1000);
    expect(body.data.connectedDatabases).toEqual(["main_pg"]);
  });

  it("reset clears tracked queries", async () => {
    const manager = new ConnectorManager(configs);
    manager.getPerformanceTracker().recordQuery("SELECT 1", 2000, "main_pg");
    const body = parse(await performanceHandler(manager)({ database: "main_pg", action: "reset" }));
    expect(body.data).toBe("Performance metrics reset");
    expect(manager.getPerformanceTracker().getSlowQueries()).toHaveLength(0);
  });

  it("setThreshold updates the tracker threshold", async () => {
    const manager = new ConnectorManager(configs);
    const body = parse(
      await performanceHandler(manager)({ database: "main_pg", action: "setThreshold", threshold: 500 }),
    );
    expect(body.data).toBe("Threshold set to 500ms");
    expect(manager.getPerformanceTracker().getThreshold()).toBe(500);
  });

  it("setThreshold without a value returns an error", async () => {
    const manager = new ConnectorManager(configs);
    const body = parse(await performanceHandler(manager)({ database: "main_pg", action: "setThreshold" }));
    expect(body.success).toBe(false);
    expect(body.error).toContain("threshold is required");
  });

  it("rejects an unknown action", async () => {
    const manager = new ConnectorManager(configs);
    const body = parse(await performanceHandler(manager)({ database: "main_pg", action: "bogus" }));
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown action");
  });

  it("surfaces DB_NOT_FOUND for an unknown database", async () => {
    const manager = new ConnectorManager(configs);
    const body = parse(await performanceHandler(manager)({ database: "nope", action: "getMetrics" }));
    expect(body.success).toBe(false);
    expect(body.code).toBe("DB_NOT_FOUND");
  });
});
