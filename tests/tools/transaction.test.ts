import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import type { TransactionHandle } from "../../src/connectors/interface.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { capRows } from "../../src/tools/write/execute.js";
import { TransactionStore, transactionHandler, transactionStore } from "../../src/tools/write/transaction.js";

function createMockTransaction(id: string): TransactionHandle {
  return {
    id,
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
}

function parseResponse(result: { content: { text: string }[] }): {
  success: boolean;
  error?: string;
  code?: string;
  database?: string;
  rows?: unknown[];
  count?: number;
  truncatedAt?: number;
  data?: unknown;
} {
  return JSON.parse(result.content[0].text);
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

  it("take() atomically claims the entry and clears its TTL timer", () => {
    const store = new TransactionStore(5_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");

    const claimed = store.take("tx-1");
    expect(claimed!.handle).toBe(tx);
    expect(store.get("tx-1")).toBeUndefined();

    // TTL must not fire anymore since take() already cleared the timer
    vi.advanceTimersByTime(5_000);
    expect(tx.rollback).not.toHaveBeenCalled();
  });

  it("take() only lets one caller claim a given transaction", () => {
    const store = new TransactionStore(5_000);
    const tx = createMockTransaction("tx-1");
    store.add(tx, "db1");

    const first = store.take("tx-1");
    const second = store.take("tx-1");

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it("cleanupAll skips transactions already claimed by another caller", async () => {
    const store = new TransactionStore(60_000);
    const tx1 = createMockTransaction("tx-1");
    const tx2 = createMockTransaction("tx-2");
    store.add(tx1, "db1");
    store.add(tx2, "db2");

    // Simulate tx-1 already finalized (e.g. by a concurrent commit) before cleanup runs
    store.take("tx-1");

    await store.cleanupAll();

    expect(tx1.rollback).not.toHaveBeenCalled();
    expect(tx2.rollback).toHaveBeenCalledOnce();
  });
});

describe("transactionHandler TTL vs commit/rollback race", () => {
  const mockConfigs: ResolvedDatabaseConfig[] = [
    {
      id: "tx_db",
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
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await transactionStore.cleanupAll();
    vi.useRealTimers();
  });

  it("does not double-finalize when the TTL fires while commit is in-flight", async () => {
    const manager = new ConnectorManager(mockConfigs);
    let resolveCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const handle = createMockTransaction("tx-slow-commit");
    (handle.commit as ReturnType<typeof vi.fn>).mockImplementation(() => commitGate);
    transactionStore.add(handle, "tx_db");

    const commitCall = transactionHandler(manager)({
      action: "commit",
      database: "tx_db",
      transactionId: "tx-slow-commit",
    });

    // The commit branch claims the entry (and clears the TTL timer) synchronously
    // before awaiting handle.commit(), so advancing past the TTL here must be a no-op.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(handle.rollback).not.toHaveBeenCalled();

    resolveCommit();
    const body = parseResponse(await commitCall);

    expect(body.success).toBe(true);
    expect(handle.commit).toHaveBeenCalledOnce();
    expect(handle.rollback).not.toHaveBeenCalled();
  });

  it("commit after TTL expiry returns TX_NOT_FOUND instead of double-finalizing", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-ttl-expired");
    transactionStore.add(handle, "tx_db");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(handle.rollback).toHaveBeenCalledOnce();

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "commit",
        database: "tx_db",
        transactionId: "tx-ttl-expired",
      }),
    );

    expect(body.success).toBe(false);
    expect(body.code).toBe("TX_NOT_FOUND");
    expect(handle.commit).not.toHaveBeenCalled();
    expect(handle.rollback).toHaveBeenCalledOnce();
  });

  it("rollback after TTL expiry returns TX_NOT_FOUND instead of double-finalizing", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-ttl-expired-2");
    transactionStore.add(handle, "tx_db");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(handle.rollback).toHaveBeenCalledOnce();

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "rollback",
        database: "tx_db",
        transactionId: "tx-ttl-expired-2",
      }),
    );

    expect(body.success).toBe(false);
    expect(body.code).toBe("TX_NOT_FOUND");
    expect(handle.rollback).toHaveBeenCalledOnce();
  });
});

describe("transactionHandler response database field", () => {
  const mockConfigs: ResolvedDatabaseConfig[] = [
    {
      id: "tx_db",
      type: "postgresql",
      host: "localhost",
      port: 5432,
      database: "testdb",
      user: "user",
      password: "pass",
      sslRejectUnauthorized: true,
      lazyConnection: true,
      maxRows: 2,
      queryTimeout: 30000,
    },
  ];

  afterEach(async () => {
    await transactionStore.cleanupAll();
  });

  it("execute reports the database resolved at begin, not the raw input param", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-report-exec");
    transactionStore.add(handle, "tx_db");

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "execute",
        database: "totally-different-id",
        transactionId: "tx-report-exec",
        statement: "SELECT 1",
      }),
    );

    expect(body.database).toBe("tx_db");
  });

  it("commit reports the database resolved at begin, not the raw input param", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-report-commit");
    transactionStore.add(handle, "tx_db");

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "commit",
        database: "totally-different-id",
        transactionId: "tx-report-commit",
      }),
    );

    expect(body.database).toBe("tx_db");
  });

  it("rollback reports the database resolved at begin, not the raw input param", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-report-rollback");
    transactionStore.add(handle, "tx_db");

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "rollback",
        database: "totally-different-id",
        transactionId: "tx-report-rollback",
      }),
    );

    expect(body.database).toBe("tx_db");
  });

  it("execute truncates rows past the resolved database's maxRows and reports truncatedAt", async () => {
    const manager = new ConnectorManager(mockConfigs);
    const handle = createMockTransaction("tx-report-truncate");
    (handle.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
      rowCount: 3,
    });
    transactionStore.add(handle, "tx_db");

    const body = parseResponse(
      await transactionHandler(manager)({
        action: "execute",
        database: "tx_db",
        transactionId: "tx-report-truncate",
        statement: "SELECT * FROM t",
      }),
    );

    expect(body.rows).toHaveLength(2);
    expect(body.count).toBe(3);
    expect(body.truncatedAt).toBe(2);
  });
});

describe("capRows", () => {
  it("returns rows unchanged and untruncated when within the limit", () => {
    const result = capRows([1, 2, 3], 5);
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it("does not truncate when exactly at the limit", () => {
    const result = capRows([1, 2], 2);
    expect(result.rows).toEqual([1, 2]);
    expect(result.truncated).toBe(false);
  });

  it("truncates rows and flags truncated when over the limit", () => {
    const result = capRows([1, 2, 3, 4, 5], 2);
    expect(result.rows).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });
});
