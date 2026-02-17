#!/usr/bin/env node

import { watch } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, parseCliArgs } from "./config/loader.js";
import { resolveDbConfig, type HttpTransportConfig } from "./config/types.js";
import type { ConnectorManager } from "./connectors/manager.js";
import { createServer } from "./server.js";
import { transactionStore } from "./tools/write/transaction.js";
import { startHttpTransport } from "./transport/http.js";
import { initLogger } from "./utils/logger.js";

async function main() {
  const { configPath, transport: cliTransport } = parseCliArgs(process.argv.slice(2));
  const config = loadConfig(configPath);

  const logger = initLogger(config.defaults.logLevel);
  logger.info("Starting db-view-mcp", { transport: config.transport.type });

  // CLI --transport overrides config
  const transportType = cliTransport ?? config.transport.type;

  let manager: ConnectorManager;
  let shutdown: () => Promise<void>;

  if (transportType === "http") {
    const transportConfig: HttpTransportConfig =
      config.transport.type === "http"
        ? config.transport
        : { type: "http" as const, port: 3000, host: "127.0.0.1", stateless: false, sessionTimeout: 30 * 60 * 1000 };

    const { httpServer, manager: m, sessions, cleanupInterval } = await startHttpTransport(config, transportConfig);
    manager = m;

    shutdown = async () => {
      logger.info("Shutting down HTTP server...");
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      for (const [sid, entry] of sessions) {
        await entry.transport.close().catch(() => {});
        await entry.server.close().catch(() => {});
        sessions.delete(sid);
      }
      if (cleanupInterval) clearInterval(cleanupInterval);
      await transactionStore.cleanupAll();
      await manager.disconnectAll();
    };
  } else {
    const { server, manager: m } = await createServer(config);
    manager = m;
    const transport = new StdioServerTransport();
    await server.connect(transport);

    shutdown = async () => {
      logger.info("Shutting down stdio server...");
      await server.close();
      await transport.close();
      await transactionStore.cleanupAll();
      await manager.disconnectAll();
    };
  }

  // Unified shutdown handler with timeout and duplicate protection
  let shutdownInProgress = false;
  const gracefulShutdown = async () => {
    if (shutdownInProgress) {
      logger.warn("Shutdown already in progress, forcing exit");
      process.exit(1);
    }
    shutdownInProgress = true;
    const timer = setTimeout(() => {
      logger.error("Shutdown timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    timer.unref();
    try {
      await shutdown();
    } catch (err) {
      logger.error("Error during shutdown", { error: String(err) });
    }
    clearTimeout(timer);
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  // Config hot reload via file watcher
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(configPath, () => {
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(async () => {
      logger.info("Config file changed, reloading...");
      try {
        const newConfig = loadConfig(configPath);
        const newResolved = newConfig.databases.map((db) => resolveDbConfig(db, newConfig.defaults));
        const diff = manager.updateDatabases(newResolved);
        logger.info("Config reloaded", { added: diff.added, removed: diff.removed, changed: diff.changed });
      } catch (err) {
        logger.error("Failed to reload config", { error: String(err) });
      }
    }, 500);
  });
  watcher.unref();
}

main().catch((err) => {
  console.error("Failed to start db-view-mcp:", err);
  process.exit(1);
});
