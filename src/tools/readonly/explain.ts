import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";
import { validateReadonlySql } from "../../utils/sql-validator.js";

export function createExplainParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
    sql: z.string().describe("SQL query to explain"),
  };
}

export function explainHandler(manager: ConnectorManager) {
  return async (params: { database: string; sql: string }) => {
    const validation = validateReadonlySql(params.sql);
    if (!validation.valid) {
      return formatError(validation.error!, "READONLY_VIOLATION");
    }
    try {
      const connector = await manager.getConnector(params.database);
      const result = await connector.explain(params.sql);
      return formatSuccess({ data: result.plan, database: params.database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
