import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";

export function createDescribeTableParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
    table: z.string().describe("Table name"),
    schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
  };
}

export function describeTableHandler(manager: ConnectorManager) {
  return async (params: { database: string; table: string; schema?: string }) => {
    try {
      const connector = await manager.getConnector(params.database);
      const columns = await connector.describeTable(params.table, params.schema);
      return formatSuccess({ data: columns, database: params.database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
