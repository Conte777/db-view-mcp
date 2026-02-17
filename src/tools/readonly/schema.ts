import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";

export function createSchemaParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
    schema: z.string().optional().describe("Schema name (default: 'public' for PostgreSQL, ignored for ClickHouse)"),
  };
}

export function schemaHandler(manager: ConnectorManager) {
  return async (params: { database: string; schema?: string }) => {
    try {
      const connector = await manager.getConnector(params.database);
      const ddl = await connector.getSchema(params.schema);
      return formatSuccess({ data: ddl, database: params.database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
