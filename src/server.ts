import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig, resolveDbConfig } from "./config/types.js";
import { ConnectorManager } from "./connectors/manager.js";
import { registerTools } from "./tools/registry.js";
import { setRowFormat } from "./utils/response.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createConnectorManager(config: AppConfig): ConnectorManager {
  const resolvedDbs = config.databases.map((db) => resolveDbConfig(db, config.defaults));
  return new ConnectorManager(resolvedDbs);
}

export function createMcpServerInstance(manager: ConnectorManager, config: AppConfig): McpServer {
  const server = new McpServer({
    name: "db-view-mcp",
    version,
  });
  setRowFormat(config.defaults.rowFormat);
  registerTools(server, manager, config.defaults);
  return server;
}

export async function createServer(config: AppConfig) {
  const manager = createConnectorManager(config);
  const server = createMcpServerInstance(manager, config);

  await manager.connectEager();

  return { server, manager };
}
