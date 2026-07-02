import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatRows, formatError } from "../../utils/response.js";
import { validateReadonlySql } from "../../utils/sql-validator.js";
import { resolveDbId } from "../../utils/resolve-db.js";

export function createQueryToolParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    sql: z.string().describe("SELECT query to execute"),
    maxRows: z.number().optional().describe("Maximum number of rows to return"),
  };
}

export function queryToolHandler(manager: ConnectorManager) {
  return async (params: { database: string; sql: string; maxRows?: number }) => {
    const validation = validateReadonlySql(params.sql);
    if (!validation.valid) {
      return formatError(validation.error!, "READONLY_VIOLATION");
    }
    try {
      const database = resolveDbId(manager.getDatabaseIds(), params.database);
      const connector = await manager.getConnector(database);
      const result = await connector.query(params.sql, undefined, params.maxRows);
      return formatRows(result.rows, database);
    } catch (err) {
      return formatError(String(err));
    }
  };
}
