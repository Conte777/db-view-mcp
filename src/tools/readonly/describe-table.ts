import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatCaughtError, formatSuccess } from "../../utils/response.js";

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
      const { id: database, connector } = await manager.acquire(params.database);
      const columns = await connector.describeTable(params.table, params.schema);
      return formatSuccess({ data: columns, database });
    } catch (err) {
      return formatCaughtError(err);
    }
  };
}
