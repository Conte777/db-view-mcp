import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createConnectorManager, createMcpServerInstance } from "../server.js";
import type { ConnectorManager } from "../connectors/manager.js";
import type { AppConfig, HttpTransportConfig } from "../config/types.js";
import { getLogger } from "../utils/logger.js";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastAccessedAt: number;
}

export async function startHttpTransport(config: AppConfig, transportConfig: HttpTransportConfig) {
  const logger = getLogger();
  const manager = createConnectorManager(config);
  await manager.connectEager();

  const sessions = new Map<string, SessionEntry>();

  const { host, port } = transportConfig;
  const app = createMcpExpressApp({ host });

  if (transportConfig.auth) {
    const expectedValue = `Bearer ${transportConfig.auth.token}`;
    const expectedBuf = Buffer.from(expectedValue);
    app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization ?? "";
      const actualBuf = Buffer.from(authHeader);
      if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }

  let cleanupInterval: ReturnType<typeof setInterval> | undefined;

  if (transportConfig.stateless) {
    setupStatelessRoutes(app, manager, config);
  } else {
    setupStatefulRoutes(app, manager, config, sessions);

    const sessionTimeout = transportConfig.sessionTimeout;
    cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [sid, entry] of sessions) {
        if (now - entry.lastAccessedAt > sessionTimeout) {
          logger.info("Cleaning up expired session", { sessionId: sid });
          entry.transport.close().catch(() => {});
          entry.server.close().catch(() => {});
          sessions.delete(sid);
        }
      }
    }, 60_000);
    cleanupInterval.unref();
  }

  setupHealthEndpoint(app, manager, sessions);

  const httpServer = await new Promise<Server>((resolve) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
  });

  logger.info(`HTTP server listening on http://${host}:${port}/mcp`);
  logger.info(`Health check: http://${host}:${port}/health`);
  logger.info(`Mode: ${transportConfig.stateless ? "stateless" : "stateful (session-based)"}`);

  return { httpServer, manager, sessions, cleanupInterval };
}

function setupStatelessRoutes(
  app: ReturnType<typeof createMcpExpressApp>,
  manager: ConnectorManager,
  config: AppConfig,
) {
  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createMcpServerInstance(manager, config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);

    // Close after handling since stateless has no persistent sessions
    await transport.close();
    await server.close();
  });
}

function setupStatefulRoutes(
  app: ReturnType<typeof createMcpExpressApp>,
  manager: ConnectorManager,
  config: AppConfig,
  sessions: Map<string, SessionEntry>,
) {
  app.all("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastAccessedAt = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId && !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // New session — create McpServer + transport
    const server = createMcpServerInstance(manager, config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { transport, server, lastAccessedAt: Date.now() });
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}

function setupHealthEndpoint(
  app: ReturnType<typeof createMcpExpressApp>,
  manager: ConnectorManager,
  sessions: Map<string, SessionEntry>,
) {
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      activeSessions: sessions.size,
      databases: manager.getDatabaseIds(),
    });
  });
}
