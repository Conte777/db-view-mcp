import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { readFileSync } from "node:fs";
import type { Connector, QueryResult, TableInfo, ColumnInfo, ExplainResult, TransactionHandle } from "./interface.js";
import type { ClickHouseConfig } from "../config/types.js";

export class ClickHouseConnector implements Connector {
  readonly type = "clickhouse" as const;
  private client: ClickHouseClient | null = null;
  private config: ClickHouseConfig;
  private maxRows: number;
  private queryTimeout: number;

  constructor(config: ClickHouseConfig, queryTimeout: number, maxRows: number) {
    this.config = config;
    this.queryTimeout = queryTimeout;
    this.maxRows = maxRows;
  }

  async connect(): Promise<void> {
    const tlsConfig = this.config.tls?.ca
      ? {
          ca_cert: this.config.tls.ca.startsWith("-----BEGIN")
            ? Buffer.from(this.config.tls.ca)
            : readFileSync(this.config.tls.ca),
          reject_unauthorized: this.config.tls.rejectUnauthorized,
        }
      : undefined;

    this.client = createClient({
      url: this.config.url,
      database: this.config.database,
      username: this.config.user,
      password: this.config.password,
      request_timeout: this.queryTimeout,
      ...(tlsConfig && { tls: tlsConfig }),
    });
    await this.client.ping();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private getClient(): ClickHouseClient {
    if (!this.client) throw new Error("Not connected");
    return this.client;
  }

  async query(sql: string, _params?: string[], maxRows?: number): Promise<QueryResult> {
    const limit = maxRows ?? this.maxRows;
    const wrappedSql = `SELECT * FROM (${sql}) AS _q LIMIT ${limit}`;
    const result = await this.getClient().query({ query: wrappedSql, format: "JSONEachRow" });
    const rows = (await result.json()) as Record<string, unknown>[];
    return { rows, rowCount: rows.length };
  }

  async execute(sql: string, _params?: string[]): Promise<QueryResult> {
    await this.getClient().command({ query: sql });
    return { rows: [], rowCount: 0 };
  }

  async listTables(_schema?: string): Promise<TableInfo[]> {
    const result = await this.getClient().query({
      query: `SELECT name, engine FROM system.tables WHERE database = currentDatabase() ORDER BY name`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as { name: string; engine: string }[];
    return rows.map((r) => ({
      schema: this.config.database,
      name: r.name,
      type: r.engine.includes("View") ? "view" : "table",
    }));
  }

  async describeTable(table: string, _schema?: string): Promise<ColumnInfo[]> {
    const result = await this.getClient().query({
      query: `SELECT name, type, default_kind, default_expression, is_in_primary_key
              FROM system.columns
              WHERE database = currentDatabase() AND table = {table:String}
              ORDER BY position`,
      format: "JSONEachRow",
      query_params: { table },
    });
    const rows = (await result.json()) as {
      name: string;
      type: string;
      default_kind: string;
      default_expression: string;
      is_in_primary_key: number;
    }[];
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.type.startsWith("Nullable"),
      defaultValue: r.default_expression || null,
      isPrimaryKey: r.is_in_primary_key === 1,
    }));
  }

  async getSchema(_schema?: string): Promise<string> {
    const result = await this.getClient().query({
      query: `SELECT name, create_table_query FROM system.tables WHERE database = currentDatabase()`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as { name: string; create_table_query: string }[];
    return rows.map((r) => r.create_table_query).join(";\n\n");
  }

  async explain(sql: string, analyze = false): Promise<ExplainResult> {
    const prefix = analyze ? "EXPLAIN ANALYZE" : "EXPLAIN";
    const result = await this.getClient().query({
      query: `${prefix} ${sql}`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as { explain: string }[];
    return { plan: rows.map((r) => r.explain).join("\n") };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    throw new Error("Transactions are not supported in ClickHouse");
  }
}
