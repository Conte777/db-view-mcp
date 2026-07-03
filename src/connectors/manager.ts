import type { ResolvedDatabaseConfig } from "../config/types.js";
import { PerformanceTracker } from "../tools/readonly/performance.js";
import { resolveDbId } from "../utils/resolve-db.js";
import { ClickHouseConnector } from "./clickhouse.js";
import { InstrumentedConnector } from "./instrumented.js";
import type { Connector } from "./interface.js";
import { PostgresConnector } from "./postgresql.js";

export class ConnectorManager {
  private configs: Map<string, ResolvedDatabaseConfig> = new Map();
  private connectors: Map<string, Connector> = new Map();
  private rawConnectors: Map<string, Connector> = new Map();
  private connecting: Map<string, Promise<Connector>> = new Map();
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

    const inFlight = this.connecting.get(dbId);
    if (inFlight) return inFlight;

    const config = this.configs.get(dbId);
    if (!config) throw new Error(`Unknown database: ${dbId}`);

    // Store the connect promise before awaiting so concurrent callers hitting
    // the same miss join this one instead of each creating their own pool.
    const connectPromise = (async () => {
      const raw = this.createConnector(config);
      await raw.connect();
      // A concurrent updateDatabases()/invalidateConnector() may have replaced or removed this
      // db's config while we were connecting. Storing the connector now would pin the manager to
      // superseded (e.g. rotated/revoked) credentials, so discard it and let the caller retry.
      if (this.configs.get(dbId) !== config) {
        await raw.disconnect().catch(() => {});
        throw new Error(`Database "${dbId}" was reconfigured during connection; please retry`);
      }
      this.rawConnectors.set(dbId, raw);

      const instrumented = new InstrumentedConnector(raw, this.tracker, dbId);
      this.connectors.set(dbId, instrumented);
      return instrumented;
    })();

    this.connecting.set(dbId, connectPromise);
    try {
      return await connectPromise;
    } finally {
      this.connecting.delete(dbId);
    }
  }

  // Single source of truth for fuzzy id resolution. Handlers must go through this (or acquire())
  // rather than calling resolveDbId directly, so id-resolution stays consistent everywhere.
  resolveId(input: string): string {
    return resolveDbId(this.getDatabaseIds(), input);
  }

  async acquire(input: string): Promise<{ id: string; connector: Connector }> {
    const id = this.resolveId(input);
    const connector = await this.getConnector(id);
    return { id, connector };
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
