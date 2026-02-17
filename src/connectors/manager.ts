import type { Connector } from "./interface.js";
import type { ResolvedDatabaseConfig } from "../config/types.js";
import { PostgresConnector } from "./postgresql.js";
import { ClickHouseConnector } from "./clickhouse.js";

export class ConnectorManager {
  private configs: Map<string, ResolvedDatabaseConfig> = new Map();
  private connectors: Map<string, Connector> = new Map();

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

  async getConnector(dbId: string): Promise<Connector> {
    const existing = this.connectors.get(dbId);
    if (existing) return existing;

    const config = this.configs.get(dbId);
    if (!config) throw new Error(`Unknown database: ${dbId}`);

    const connector = this.createConnector(config);
    await connector.connect();
    this.connectors.set(dbId, connector);
    return connector;
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

  async connectEager(): Promise<void> {
    const eagerDbs = Array.from(this.configs.values()).filter((c) => !c.lazyConnection);
    await Promise.all(eagerDbs.map((db) => this.getConnector(db.id)));
  }

  async disconnectAll(): Promise<void> {
    const tasks = Array.from(this.connectors.values()).map((c) => c.disconnect());
    await Promise.all(tasks);
    this.connectors.clear();
  }
}
