import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess } from "../../utils/response.js";

export function listDatabasesHandler(manager: ConnectorManager) {
  return async () => {
    const databases = manager.getAllConfigs().map((c) => ({
      id: c.id,
      type: c.type,
      description: c.description ?? "",
    }));
    return formatSuccess({ data: databases });
  };
}
