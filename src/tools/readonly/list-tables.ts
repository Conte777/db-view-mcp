import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatCaughtError, formatSuccess } from "../../utils/response.js";

export function createListTablesParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
  };
}

export function listTablesHandler(manager: ConnectorManager) {
  return async (params: { database: string; schema?: string }) => {
    try {
      const { id: database, connector } = await manager.acquire(params.database);
      const tables = await connector.listTables(params.schema);
      return formatSuccess({ data: tables, database });
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
