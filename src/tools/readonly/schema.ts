import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";

export function createSchemaParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
  };
}

export function schemaHandler(manager: ConnectorManager) {
  return async (params: { database: string }) => {
    try {
      const connector = await manager.getConnector(params.database);
      const ddl = await connector.getSchema();
      return formatSuccess({ data: ddl, database: params.database });
    } catch (err) {
      return formatError(String(err));
    }
  };
}
