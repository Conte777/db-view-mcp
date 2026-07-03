import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatCaughtError, formatSuccess } from "../../utils/response.js";

export function capRows<T>(rows: T[], max: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= max) return { rows, truncated: false };
  return { rows: rows.slice(0, max), truncated: true };
}

export function createExecuteParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    statement: z.string().describe("SQL statement to execute (INSERT, UPDATE, DELETE, DDL, etc.)"),
    params: z.array(z.string()).optional().describe("Query parameters"),
  };
}

export function executeHandler(manager: ConnectorManager) {
  return async (params: { database: string; statement: string; params?: string[] }) => {
    try {
      const { id: database, connector } = await manager.acquire(params.database);
      const result = await connector.execute(params.statement, params.params);
      const maxRows = manager.getConfig(database)!.maxRows;
      const { rows, truncated } = capRows(result.rows, maxRows);
      return formatSuccess({
        rows,
        count: result.rowCount,
        database,
        ...(truncated ? { truncatedAt: maxRows } : {}),
      });
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
