import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TransactionStore } from "../../src/tools/write/transaction.js";
import type { TransactionHandle } from "../../src/connectors/interface.js";

function createMockTransaction(id: string): TransactionHandle {
  return {
    id,
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TransactionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves transactions", () => {
    const store = new TransactionStore(60_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");
    expect(store.get("tx-1")).toBeDefined();
    expect(store.get("tx-1")!.handle).toBe(tx);
  });

  it("returns undefined for unknown transaction", () => {
    const store = new TransactionStore(60_000);
    expect(store.get("unknown")).toBeUndefined();
  });

  it("removes transaction", () => {
    const store = new TransactionStore(60_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");
    store.remove("tx-1");
    expect(store.get("tx-1")).toBeUndefined();
  });

  it("auto-rollbacks after TTL expires", async () => {
    const store = new TransactionStore(5_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");

    vi.advanceTimersByTime(5_000);
    // Wait for the async auto-rollback to complete
    await vi.runAllTimersAsync();

    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(store.get("tx-1")).toBeUndefined();
  });

  it("does not auto-rollback before TTL", () => {
    const store = new TransactionStore(5_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");

    vi.advanceTimersByTime(4_999);
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(store.get("tx-1")).toBeDefined();
  });

  it("cleanupAll rolls back all transactions", async () => {
    const store = new TransactionStore(60_000);
    const tx1 = createMockTransaction("tx-1");
    const tx2 = createMockTransaction("tx-2");
    store.add(tx1, "db1");
    store.add(tx2, "db2");

    await store.cleanupAll();

    expect(tx1.rollback).toHaveBeenCalledOnce();
    expect(tx2.rollback).toHaveBeenCalledOnce();
    expect(store.get("tx-1")).toBeUndefined();
    expect(store.get("tx-2")).toBeUndefined();
  });

  it("handles rollback errors gracefully in auto-rollback", async () => {
    const store = new TransactionStore(5_000);
    const tx = createMockTransaction("tx-1");
    (tx.rollback as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection lost"));
    store.add(tx, "db1");

    vi.advanceTimersByTime(5_000);
    await vi.runAllTimersAsync();

    // Should not throw, just log
    expect(store.get("tx-1")).toBeUndefined();
  });
});
