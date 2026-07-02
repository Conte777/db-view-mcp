import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";
import { resolveDbId } from "../../utils/resolve-db.js";

export function createListTablesParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
  };
}

export function listTablesHandler(manager: ConnectorManager) {
  return async (params: { database: string; schema?: string }) => {
    try {
      const database = resolveDbId(manager.getDatabaseIds(), params.database);
      const connector = await manager.getConnector(database);
      const tables = await connector.listTables(params.schema);
      return formatSuccess({ data: tables, database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
