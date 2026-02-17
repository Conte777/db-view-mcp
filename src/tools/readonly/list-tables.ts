import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";

export function createListTablesParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
    schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
  };
}

export function listTablesHandler(manager: ConnectorManager) {
  return async (params: { database: string; schema?: string }) => {
    try {
      const connector = await manager.getConnector(params.database);
      const tables = await connector.listTables(params.schema);
      return formatSuccess({ data: tables, database: params.database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
