import type { Connector } from "./interface.js";
import type { ResolvedDatabaseConfig } from "../config/types.js";
import { PostgresConnector } from "./postgresql.js";
import { ClickHouseConnector } from "./clickhouse.js";
import { InstrumentedConnector } from "./instrumented.js";
import { PerformanceTracker } from "../tools/readonly/performance.js";
import { getLogger } from "../utils/logger.js";

const CONNECTION_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);

function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && CONNECTION_ERROR_CODES.has(code)) return true;
    if (err.message.includes("Connection terminated")) return true;
    if (err.message.includes("connection refused")) return true;
  }
  return false;
}

export class ConnectorManager {
  private configs: Map<string, ResolvedDatabaseConfig> = new Map();
  private connectors: Map<string, Connector> = new Map();
  private rawConnectors: Map<string, Connector> = new Map();
  private tracker = new PerformanceTracker();

  constructor(databases: ResolvedDatabaseConfig[]) {
    for (const db of databases) {
      this.configs.set(db.id, db);
    }
  }

  getDatabaseIds(): string[] {
    return Array.from(this.configs.keys());
  }

  getConfig(dbId: string): ResolvedDatabaseConfig | undefined {
    return this.configs.get(dbId);
  }

  getAllConfigs(): ResolvedDatabaseConfig[] {
    return Array.from(this.configs.values());
  }

  getPerformanceTracker(): PerformanceTracker {
    return this.tracker;
  }

  async getConnector(dbId: string): Promise<Connector> {
    const existing = this.connectors.get(dbId);
    if (existing) return existing;

    const config = this.configs.get(dbId);
    if (!config) throw new Error(`Unknown database: ${dbId}`);

    const raw = this.createConnector(config);
    await raw.connect();
    this.rawConnectors.set(dbId, raw);

    const instrumented = new InstrumentedConnector(raw, this.tracker, dbId);
    this.connectors.set(dbId, instrumented);
    return instrumented;
  }

  async withConnector<T>(dbId: string, fn: (connector: Connector) => Promise<T>): Promise<T> {
    const connector = await this.getConnector(dbId);
    try {
      return await fn(connector);
    } catch (err) {
      if (isConnectionError(err)) {
        const logger = getLogger();
        logger.warn("Connection error, retrying", { database: dbId, error: String(err) });
        this.invalidateConnector(dbId);
        const retryConnector = await this.getConnector(dbId);
        return await fn(retryConnector);
      }
      throw err;
    }
  }

  invalidateConnector(dbId: string): void {
    const raw = this.rawConnectors.get(dbId);
    if (raw) {
      raw.disconnect().catch(() => {});
      this.rawConnectors.delete(dbId);
    }
    this.connectors.delete(dbId);
  }

  private createConnector(config: ResolvedDatabaseConfig): Connector {
    if (config.type === "postgresql") {
      return new PostgresConnector(config, config.queryTimeout, config.maxRows);
    }
    if (config.type === "clickhouse") {
      return new ClickHouseConnector(config, config.queryTimeout, config.maxRows);
    }
    throw new Error(`Unsupported database type: ${(config as { type: string }).type}`);
  }

  updateDatabases(newConfigs: ResolvedDatabaseConfig[]): { added: string[]; removed: string[]; changed: string[] } {
    const newMap = new Map(newConfigs.map((c) => [c.id, c]));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Removed databases
    for (const id of this.configs.keys()) {
      if (!newMap.has(id)) {
        removed.push(id);
        this.invalidateConnector(id);
        this.configs.delete(id);
      }
    }

    // Added and changed databases
    for (const [id, cfg] of newMap) {
      const old = this.configs.get(id);
      if (!old) {
        added.push(id);
        this.configs.set(id, cfg);
      } else if (JSON.stringify(old) !== JSON.stringify(cfg)) {
        changed.push(id);
        this.invalidateConnector(id);
        this.configs.set(id, cfg);
      }
    }

    return { added, removed, changed };
  }

  async connectEager(): Promise<void> {
    const eagerDbs = Array.from(this.configs.values()).filter((c) => !c.lazyConnection);
    await Promise.all(eagerDbs.map((db) => this.getConnector(db.id)));
  }

  async disconnectAll(): Promise<void> {
    const tasks = Array.from(this.rawConnectors.values()).map((c) => c.disconnect());
    await Promise.all(tasks);
    this.connectors.clear();
    this.rawConnectors.clear();
  }
}
