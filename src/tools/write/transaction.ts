import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import type { TransactionHandle } from "../../connectors/interface.js";
import { formatSuccess, formatError } from "../../utils/response.js";
import { getLogger } from "../../utils/logger.js";

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

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(id);
    }
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
    const entry = this.entries.get(id);
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
    } finally {
      clearTimeout(entry.timer);
      this.entries.delete(id);
    }
  }
}

export const transactionStore = new TransactionStore();

export function createTransactionParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
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
          const connector = await manager.getConnector(params.database);
          const tx = await connector.beginTransaction();
          transactionStore.add(tx, params.database);
          return formatSuccess({
            data: { transactionId: tx.id, message: "Transaction started" },
            database: params.database,
          });
        }

        case "execute": {
          if (!params.transactionId) return formatError("transactionId is required for execute");
          if (!params.statement) return formatError("statement is required for execute");
          const entry = transactionStore.get(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          const result = await entry.handle.execute(params.statement, params.params);
          return formatSuccess({
            rows: result.rows,
            count: result.rowCount,
            database: params.database,
          });
        }

        case "commit": {
          if (!params.transactionId) return formatError("transactionId is required for commit");
          const entry = transactionStore.get(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await entry.handle.commit();
          transactionStore.remove(params.transactionId);
          return formatSuccess({
            data: { message: "Transaction committed" },
            database: params.database,
          });
        }

        case "rollback": {
          if (!params.transactionId) return formatError("transactionId is required for rollback");
          const entry = transactionStore.get(params.transactionId);
          if (!entry) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await entry.handle.rollback();
          transactionStore.remove(params.transactionId);
          return formatSuccess({
            data: { message: "Transaction rolled back" },
            database: params.database,
          });
        }

        default:
          return formatError(`Unknown action: ${params.action}`);
      }
    } catch (err) {
      return formatError(String(err));
    }
  };
}
