import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";
import { resolveDbId } from "../../utils/resolve-db.js";

export function createDescribeTableParams(dbIds: string[]) {
  return {
    database: z.string().describe(`Database ID. Available: ${dbIds.join(", ")}`),
    table: z.string().describe("Table name"),
    schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
  };
}

export function describeTableHandler(manager: ConnectorManager) {
  return async (params: { database: string; table: string; schema?: string }) => {
    try {
      const database = resolveDbId(manager.getDatabaseIds(), params.database);
      const connector = await manager.getConnector(database);
      const columns = await connector.describeTable(params.table, params.schema);
      return formatSuccess({ data: columns, database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
