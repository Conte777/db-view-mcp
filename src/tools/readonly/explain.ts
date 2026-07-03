import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatCaughtError, formatError, formatSuccess } from "../../utils/response.js";
import { validateReadonlySql } from "../../utils/sql-validator.js";

export function createExplainParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    sql: z.string().describe("SQL query to explain"),
    analyze: z.boolean().optional().describe("Run EXPLAIN ANALYZE (actually executes the query). Default: false"),
  };
}

export function explainHandler(manager: ConnectorManager) {
  return async (params: { database: string; sql: string; analyze?: boolean }) => {
    const validation = validateReadonlySql(params.sql);
    if (!validation.valid) {
      return formatError(validation.error!, "READONLY_VIOLATION");
    }
    try {
      const { id: database, connector } = await manager.acquire(params.database);
      const result = await connector.explain(validation.normalizedSql ?? params.sql, params.analyze ?? false);
      return formatSuccess({ data: result.plan, database });
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
