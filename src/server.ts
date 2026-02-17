import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorManager } from "./connectors/manager.js";
import { registerTools } from "./tools/registry.js";
import { resolveDbConfig, type AppConfig } from "./config/types.js";

export function createConnectorManager(config: AppConfig): ConnectorManager {
  const resolvedDbs = config.databases.map((db) =>
    resolveDbConfig(db, config.defaults),
  );
  return new ConnectorManager(resolvedDbs);
}

export function createMcpServerInstance(
  manager: ConnectorManager,
  config: AppConfig,
): McpServer {
  const server = new McpServer({
    name: "db-view-mcp",
    version: "1.0.0",
  });
  registerTools(server, manager, config.defaults);
  return server;
}

export async function createServer(config: AppConfig) {
  const manager = createConnectorManager(config);
  const server = createMcpServerInstance(manager, config);

  await manager.connectEager();

  return { server, manager };
}
