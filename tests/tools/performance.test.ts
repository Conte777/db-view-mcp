import { describe, it, expect, beforeEach } from "vitest";
import { PerformanceTracker } from "../../src/tools/readonly/performance.js";

describe("PerformanceTracker", () => {
  let tracker: PerformanceTracker;

  beforeEach(() => {
    tracker = new PerformanceTracker();
  });

  it("records slow queries above threshold", () => {
    tracker.recordQuery("SELECT 1", 1500, "db1");
    expect(tracker.getSlowQueries()).toHaveLength(1);
  });

  it("does not record fast queries below threshold", () => {
    tracker.recordQuery("SELECT 1", 500, "db1");
    expect(tracker.getSlowQueries()).toHaveLength(0);
  });

  it("filters by database", () => {
    tracker.recordQuery("SELECT 1", 1500, "db1");
    tracker.recordQuery("SELECT 2", 2000, "db2");
    expect(tracker.getSlowQueries("db1")).toHaveLength(1);
    expect(tracker.getSlowQueries("db2")).toHaveLength(1);
    expect(tracker.getSlowQueries()).toHaveLength(2);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordQuery(`SELECT ${i}`, 1500, "db1");
    }
    expect(tracker.getSlowQueries(undefined, 3)).toHaveLength(3);
  });

  it("returns most recent queries when limited", () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordQuery(`SELECT ${i}`, 1500, "db1");
    }
    const queries = tracker.getSlowQueries(undefined, 3);
    expect(queries[0].sql).toBe("SELECT 7");
    expect(queries[2].sql).toBe("SELECT 9");
  });

  it("caps at 100 queries", () => {
    for (let i = 0; i < 110; i++) {
      tracker.recordQuery(`SELECT ${i}`, 1500, "db1");
    }
    expect(tracker.getSlowQueries(undefined, 200)).toHaveLength(100);
  });

  it("allows changing threshold", () => {
    tracker.setThreshold(500);
    tracker.recordQuery("SELECT 1", 600, "db1");
    expect(tracker.getSlowQueries()).toHaveLength(1);
    expect(tracker.getThreshold()).toBe(500);
  });

  it("resets all queries", () => {
    tracker.recordQuery("SELECT 1", 1500, "db1");
    tracker.reset();
    expect(tracker.getSlowQueries()).toHaveLength(0);
  });
});
