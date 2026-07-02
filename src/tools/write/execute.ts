import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";
import { resolveDbId } from "../../utils/resolve-db.js";

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
      const database = resolveDbId(manager.getDatabaseIds(), params.database);
      const connector = await manager.getConnector(database);
      const result = await connector.execute(params.statement, params.params);
      return formatSuccess({
        rows: result.rows,
        count: result.rowCount,
        database,
      });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
