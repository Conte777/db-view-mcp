import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatCaughtError, formatError, formatRows } from "../../utils/response.js";
import { validateReadonlySql } from "../../utils/sql-validator.js";

export function createQueryToolParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    sql: z.string().describe("SELECT query to execute"),
    maxRows: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of rows to return. Can only lower the configured cap, not raise it."),
  };
}

export function queryToolHandler(manager: ConnectorManager) {
  return async (params: { database: string; sql: string; maxRows?: number }) => {
    const validation = validateReadonlySql(params.sql);
    if (!validation.valid) {
      return formatError(validation.error!, "READONLY_VIOLATION");
    }
    try {
      const { id: database, connector } = await manager.acquire(params.database);
      const cap = manager.getConfig(database)!.maxRows;
      const effective = Math.min(params.maxRows ?? cap, cap);
      const result = await connector.query(validation.normalizedSql ?? params.sql, undefined, effective);
      return formatRows(result.rows, database);
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
