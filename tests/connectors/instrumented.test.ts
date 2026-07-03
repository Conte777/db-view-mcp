import { describe, expect, it, vi } from "vitest";
import { InstrumentedConnector } from "../../src/connectors/instrumented.js";
import type { Connector } from "../../src/connectors/interface.js";
import type { PerformanceTracker } from "../../src/tools/readonly/performance.js";

function fakeInner(overrides: Partial<Connector> = {}): Connector {
  return {
    type: "postgresql",
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    listTables: vi.fn().mockResolvedValue([]),
    describeTable: vi.fn().mockResolvedValue([]),
    getSchema: vi.fn().mockResolvedValue("ddl"),
    explain: vi.fn().mockResolvedValue({ plan: "p" }),
    beginTransaction: vi.fn().mockResolvedValue({ id: "t" }),
    ...overrides,
  };
}

function fakeTracker() {
  return { recordQuery: vi.fn() } as unknown as PerformanceTracker;
}

describe("InstrumentedConnector", () => {
  it("mirrors the inner connector type", () => {
    const ch = fakeInner({ type: "clickhouse" });
    expect(new InstrumentedConnector(ch, fakeTracker(), "db").type).toBe("clickhouse");
  });

  it("records query timing on success and forwards args", async () => {
    const tracker = fakeTracker();
    const inner = fakeInner({ query: vi.fn().mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 }) });
    const res = await new InstrumentedConnector(inner, tracker, "db1").query("SELECT 1", ["p"], 50);
    expect(res.rowCount).toBe(1);
    expect(inner.query).toHaveBeenCalledWith("SELECT 1", ["p"], 50);
    expect(tracker.recordQuery).toHaveBeenCalledWith("SELECT 1", expect.any(Number), "db1");
  });

  it("records query timing even when the inner query throws", async () => {
    const tracker = fakeTracker();
    const inner = fakeInner({ query: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(new InstrumentedConnector(inner, tracker, "db1").query("SELECT 1")).rejects.toThrow("boom");
    expect(tracker.recordQuery).toHaveBeenCalledWith("SELECT 1", expect.any(Number), "db1");
  });

  it("records execute timing on success and forwards args", async () => {
    const tracker = fakeTracker();
    const inner = fakeInner();
    await new InstrumentedConnector(inner, tracker, "db1").execute("INSERT", ["x"]);
    expect(inner.execute).toHaveBeenCalledWith("INSERT", ["x"]);
    expect(tracker.recordQuery).toHaveBeenCalledWith("INSERT", expect.any(Number), "db1");
  });

  it("records execute timing even when the inner execute throws", async () => {
    const tracker = fakeTracker();
    const inner = fakeInner({ execute: vi.fn().mockRejectedValue(new Error("nope")) });
    await expect(new InstrumentedConnector(inner, tracker, "db1").execute("INSERT")).rejects.toThrow("nope");
    expect(tracker.recordQuery).toHaveBeenCalledOnce();
  });

  it("passes through non-instrumented methods without recording", async () => {
    const tracker = fakeTracker();
    const inner = fakeInner();
    const c = new InstrumentedConnector(inner, tracker, "db1");
    await c.connect();
    await c.disconnect();
    await c.listTables("s");
    await c.describeTable("t", "s");
    await c.getSchema("s");
    await c.explain("SELECT 1", true);
    await c.beginTransaction();
    expect(inner.connect).toHaveBeenCalledOnce();
    expect(inner.disconnect).toHaveBeenCalledOnce();
    expect(inner.listTables).toHaveBeenCalledWith("s");
    expect(inner.describeTable).toHaveBeenCalledWith("t", "s");
    expect(inner.getSchema).toHaveBeenCalledWith("s");
    expect(inner.explain).toHaveBeenCalledWith("SELECT 1", true);
    expect(inner.beginTransaction).toHaveBeenCalledOnce();
    expect(tracker.recordQuery).not.toHaveBeenCalled();
  });
});
