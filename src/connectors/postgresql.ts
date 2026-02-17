import pg from "pg";
import { randomUUID } from "node:crypto";
import type {
  Connector,
  QueryResult,
  TableInfo,
  ColumnInfo,
  ExplainResult,
  TransactionHandle,
} from "./interface.js";
import type { PostgresConfig } from "../config/types.js";

export class PostgresConnector implements Connector {
  readonly type = "postgresql" as const;
  private pool: pg.Pool | null = null;
  private config: PostgresConfig;
  private queryTimeout: number;
  private maxRows: number;

  constructor(config: PostgresConfig, queryTimeout: number, maxRows: number) {
    this.config = config;
    this.queryTimeout = queryTimeout;
    this.maxRows = maxRows;
  }

  async connect(): Promise<void> {
    this.pool = new pg.Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
    // Verify connection
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  private getPool(): pg.Pool {
    if (!this.pool) throw new Error("Not connected");
    return this.pool;
  }

  async query(sql: string, params?: string[], maxRows?: number): Promise<QueryResult> {
    const limit = maxRows ?? this.maxRows;
    const wrappedSql = `SELECT * FROM (${sql}) AS _q LIMIT ${limit}`;
    const result = await this.getPool().query(wrappedSql, params);
    return { rows: result.rows, rowCount: result.rows.length };
  }

  async execute(sql: string, params?: string[]): Promise<QueryResult> {
    const result = await this.getPool().query(sql, params);
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
  }

  async listTables(schema?: string): Promise<TableInfo[]> {
    const s = schema ?? "public";
    const result = await this.getPool().query(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [s]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      schema: r.table_schema as string,
      name: r.table_name as string,
      type: (r.table_type as string) === "BASE TABLE" ? "table" : "view",
    }));
  }

  async describeTable(table: string, schema?: string): Promise<ColumnInfo[]> {
    const s = schema ?? "public";
    const result = await this.getPool().query(
      `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.column_default,
         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku
           ON tc.constraint_name = ku.constraint_name
           AND tc.table_schema = ku.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_name = $1
           AND tc.table_schema = $2
       ) pk ON c.column_name = pk.column_name
       WHERE c.table_name = $1 AND c.table_schema = $2
       ORDER BY c.ordinal_position`,
      [table, s]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: (r.is_nullable as string) === "YES",
      defaultValue: r.column_default as string | null,
      isPrimaryKey: r.is_primary_key as boolean,
    }));
  }

  async getSchema(): Promise<string> {
    const result = await this.getPool().query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`
    );
    const tables = new Map<string, string[]>();
    for (const row of result.rows) {
      const t = row.table_name as string;
      if (!tables.has(t)) tables.set(t, []);
      const nullable = (row.is_nullable as string) === "YES" ? " NULL" : " NOT NULL";
      const def = row.column_default ? ` DEFAULT ${row.column_default}` : "";
      tables.get(t)!.push(`  ${row.column_name} ${row.data_type}${nullable}${def}`);
    }
    const lines: string[] = [];
    for (const [table, cols] of tables) {
      lines.push(`CREATE TABLE ${table} (`);
      lines.push(cols.join(",\n"));
      lines.push(`);\n`);
    }
    return lines.join("\n");
  }

  async explain(sql: string): Promise<ExplainResult> {
    const result = await this.getPool().query(`EXPLAIN ANALYZE ${sql}`);
    const plan = result.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n");
    return { plan };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const client = await this.getPool().connect();
    await client.query("BEGIN");
    const id = randomUUID();
    return {
      id,
      async execute(sql: string, params?: string[]): Promise<QueryResult> {
        const result = await client.query(sql, params);
        return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
      },
      async commit(): Promise<void> {
        await client.query("COMMIT");
        client.release();
      },
      async rollback(): Promise<void> {
        await client.query("ROLLBACK");
        client.release();
      },
    };
  }
}
