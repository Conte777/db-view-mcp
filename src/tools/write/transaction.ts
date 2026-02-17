import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import type { TransactionHandle } from "../../connectors/interface.js";
import { formatSuccess, formatError } from "../../utils/response.js";

const activeTransactions = new Map<string, TransactionHandle>();

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
          activeTransactions.set(tx.id, tx);
          return formatSuccess({
            data: { transactionId: tx.id, message: "Transaction started" },
            database: params.database,
          });
        }

        case "execute": {
          if (!params.transactionId) return formatError("transactionId is required for execute");
          if (!params.statement) return formatError("statement is required for execute");
          const tx = activeTransactions.get(params.transactionId);
          if (!tx) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          const result = await tx.execute(params.statement, params.params);
          return formatSuccess({
            rows: result.rows,
            count: result.rowCount,
            database: params.database,
          });
        }

        case "commit": {
          if (!params.transactionId) return formatError("transactionId is required for commit");
          const tx = activeTransactions.get(params.transactionId);
          if (!tx) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await tx.commit();
          activeTransactions.delete(params.transactionId);
          return formatSuccess({
            data: { message: "Transaction committed" },
            database: params.database,
          });
        }

        case "rollback": {
          if (!params.transactionId) return formatError("transactionId is required for rollback");
          const tx = activeTransactions.get(params.transactionId);
          if (!tx) return formatError(`Transaction not found: ${params.transactionId}`, "TX_NOT_FOUND");
          await tx.rollback();
          activeTransactions.delete(params.transactionId);
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
