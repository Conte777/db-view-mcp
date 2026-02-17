#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, parseCliArgs } from "./config/loader.js";
import { createServer } from "./server.js";
import { startHttpTransport } from "./transport/http.js";
import type { HttpTransportConfig } from "./config/types.js";
import { initLogger } from "./utils/logger.js";
import { transactionStore } from "./tools/write/transaction.js";

async function main() {
  const { configPath, transport: cliTransport } = parseCliArgs(process.argv.slice(2));
  const config = loadConfig(configPath);

  const logger = initLogger(config.defaults.logLevel);
  logger.info("Starting db-view-mcp", { transport: config.transport.type });

  // CLI --transport overrides config
  const transportType = cliTransport ?? config.transport.type;

  if (transportType === "http") {
    const transportConfig: HttpTransportConfig =
      config.transport.type === "http"
        ? config.transport
        : { type: "http" as const, port: 3000, host: "127.0.0.1", stateless: false, sessionTimeout: 30 * 60 * 1000 };

    const { httpServer, manager } = await startHttpTransport(config, transportConfig);

    const shutdown = async () => {
      logger.info("Shutting down HTTP server...");
      await transactionStore.cleanupAll();
      httpServer.close();
      await manager.disconnectAll();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    const { server, manager } = await createServer(config);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.on("SIGINT", async () => {
      await transactionStore.cleanupAll();
      await manager.disconnectAll();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await transactionStore.cleanupAll();
      await manager.disconnectAll();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("Failed to start db-view-mcp:", err);
  process.exit(1);
});
