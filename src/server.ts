import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorManager } from "./connectors/manager.js";
import { registerTools } from "./tools/registry.js";
import { resolveDbConfig, type AppConfig } from "./config/types.js";

export async function createServer(config: AppConfig) {
  const server = new McpServer({
    name: "db-view-mcp",
    version: "1.0.0",
  });

  const resolvedDbs = config.databases.map((db) =>
    resolveDbConfig(db, config.defaults),
  );

  const manager = new ConnectorManager(resolvedDbs);

  registerTools(server, manager, config.defaults);

  // Connect eager databases
  await manager.connectEager();

  return { server, manager };
}
