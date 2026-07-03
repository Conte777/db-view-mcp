import { z } from "zod";
import type { TransactionHandle } from "../../connectors/interface.js";
import type { ConnectorManager } from "../../connectors/manager.js";
import { getLogger } from "../../utils/logger.js";
import { formatCaughtError, formatError, formatSuccess } from "../../utils/response.js";
import { capRows } from "./execute.js";

const DEFAULT_TX_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface TransactionEntry {
  handle: TransactionHandle;
  database: string;
  timer: ReturnType<typeof setTimeout>;
}

export class TransactionStore {
  private entries = new Map<string, TransactionEntry>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TX_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  add(handle: TransactionHandle, database: string): void {
    const timer = setTimeout(() => {
      this.autoRollback(handle.id);
    }, this.ttlMs);
    timer.unref();
    this.entries.set(handle.id, { handle, database, timer });
  }

  get(id: string): TransactionEntry | undefined {
    return this.entries.get(id);
  }

  // Synchronous claim: Map.delete happens with no `await` in between, so whichever
  // caller (handler or TTL callback) reaches this first is the only one that gets
  // to finalize the transaction. The old get()...await...delete() sequence let the
  // TTL callback interleave during the await and finalize the same handle twice.
  take(id: string): TransactionEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    return entry;
  }

  remove(id: string): void {
    this.take(id);
  }

  async cleanupAll(): Promise<void> {
    const logger = getLogger();
    const ids = Array.from(this.entries.keys());
    for (const id of ids) {
      await this.autoRollback(id);
    }
    logger.info("All transactions cleaned up", { count: ids.length });
  }

  private async autoRollback(id: string): Promise<void> {
    const entry = this.take(id);
    if (!entry) return;
    const logger = getLogger();
    try {
      await entry.handle.rollback();
      logger.warn("Transaction auto-rolled back due to TTL expiry", {
        transactionId: id,
        database: entry.database,
      });
    } catch (err) {
      logger.error("Failed to auto-rollback transaction", {
        transactionId: id,
        error: String(err),
      });
    }
  }
}

export const transactionStore = new TransactionStore();

export function createTransactionParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    action: z.enum(["begin", "commit", "rollback", "execute"]).describe("Transaction action"),
    transactionId: z.string().optional().describe("Transaction ID (required for commit, rollback, execute)"),
    statement: z.string().optional().describe("SQL statement (required for execute)"),
    params: z.array(z.string()).optional().describe("Query parameters (for execute)"),
  };
}

export function transactionHandler(manager: ConnectorManager) {
  return async (params: {
    database: string;
    action: string;
    transactionId?: string;
    statement?: string;
    params?: string[];
  }) => {
    try {
      switch (params.action) {
        case "begin": {
          const { id: database, connector } = await manager.acquire(params.database);
          const tx = await connector.beginTransaction();
          transactionStore.add(tx, database);
          return formatSuccess({
            data: { transactionId: tx.id, message: "Transaction started" },
            database,
          });
        }

        case "execute": {
          if (!params.transactionId) return formatError("transactionId is required for execute");
          if (!params.statement) return formatError("statement is required for execute");
          // Non-finalizing lookup: a tx claimed (and finalized) by commit/rollback/TTL
          // concurrently will simply fail at the driver level with a clear error.
          const entry = transactionStore.get(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          const result = await entry.handle.execute(params.statement, params.params);
          const maxRows = manager.getConfig(entry.database)!.maxRows;
          const { rows, truncated } = capRows(result.rows, maxRows);
          return formatSuccess({
            rows,
            count: result.rowCount,
            database: entry.database,
            ...(truncated ? { truncatedAt: maxRows } : {}),
          });
        }

        case "commit": {
          if (!params.transactionId) return formatError("transactionId is required for commit");
          // Claim first: if the TTL fires concurrently it will find nothing to take.
          const entry = transactionStore.take(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await entry.handle.commit();
          return formatSuccess({
            data: { message: "Transaction committed" },
            database: entry.database,
          });
        }

        case "rollback": {
          if (!params.transactionId) return formatError("transactionId is required for rollback");
          const entry = transactionStore.take(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await entry.handle.rollback();
          return formatSuccess({
            data: { message: "Transaction rolled back" },
            database: entry.database,
          });
        }

        default:
          return formatError(`Unknown action: ${params.action}`);
      }
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
