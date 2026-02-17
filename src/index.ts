#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, parseCliArgs } from "./config/loader.js";
import { createServer } from "./server.js";

async function main() {
  const { configPath } = parseCliArgs(process.argv.slice(2));
  const config = loadConfig(configPath);

  const { server, manager } = await createServer(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await manager.disconnectAll();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await manager.disconnectAll();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start db-view-mcp:", err);
  process.exit(1);
});
