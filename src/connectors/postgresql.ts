import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import type { PostgresConfig } from "../config/types.js";
import { wrapReadonlyQuery } from "../utils/sql-validator.js";
import type { ColumnInfo, Connector, ExplainResult, QueryResult, TableInfo, TransactionHandle } from "./interface.js";

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
    const sslConfig = this.config.ssl
      ? {
          rejectUnauthorized: this.config.sslRejectUnauthorized,
          ...(this.config.sslCa && {
            ca: this.config.sslCa.startsWith("-----BEGIN")
              ? this.config.sslCa
              : readFileSync(this.config.sslCa, "utf-8"),
          }),
        }
      : undefined;

    const poolOptions: pg.PoolConfig = this.config.connectionString
      ? {
          connectionString: this.config.connectionString,
          ssl: sslConfig,
          max: 10,
          query_timeout: this.queryTimeout,
        }
      : {
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
          password: this.config.password,
          ssl: sslConfig,
          max: 10,
          query_timeout: this.queryTimeout,
        };

    this.pool = new pg.Pool(poolOptions);
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
    const wrappedSql = wrapReadonlyQuery(sql, limit, "postgresql");
    // READ ONLY blocks writes/temp-table tricks, but not pg_terminate_backend/pg_read_file — those are guarded by the sql-validator deny-list
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      // SET LOCAL instead of pool statement_timeout: pooler-safe (PgBouncer transaction mode rejects it as a startup param), scoped to this txn
      await client.query(`SET LOCAL statement_timeout = ${this.queryTimeout}`);
      const result = await client.query(wrappedSql, params);
      await client.query("COMMIT");
      return { rows: result.rows, rowCount: result.rows.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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
      [s],
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
      [table, s],
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: (r.is_nullable as string) === "YES",
      defaultValue: r.column_default as string | null,
      isPrimaryKey: r.is_primary_key as boolean,
    }));
  }

  async getSchema(schema?: string): Promise<string> {
    const s = schema ?? "public";
    const result = await this.getPool().query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [s],
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

  async explain(sql: string, analyze = false): Promise<ExplainResult> {
    const prefix = analyze ? "EXPLAIN ANALYZE" : "EXPLAIN";
    // EXPLAIN ANALYZE actually runs the statement, so mirror query()'s READ ONLY transaction as a
    // DB-level backstop to the validator rather than executing directly on the pool.
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${this.queryTimeout}`);
      const result = await client.query(`${prefix} ${sql}`);
      await client.query("COMMIT");
      const plan = result.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n");
      return { plan };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
    } catch (err) {
      client.release();
      throw err;
    }
    const id = randomUUID();
    let released = false;
    const releaseOnce = (err?: Error) => {
      if (!released) {
        released = true;
        client.release(err);
      }
    };
    return {
      id,
      async execute(sql: string, params?: string[]): Promise<QueryResult> {
        if (released) throw new Error("Transaction already finalized");
        const result = await client.query(sql, params);
        return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
      },
      async commit(): Promise<void> {
        if (released) throw new Error("Transaction already finalized");
        try {
          await client.query("COMMIT");
          releaseOnce();
        } catch (err) {
          // Hand the (possibly poisoned) connection back with the error so pg destroys it
          // instead of returning a half-transactional client to the pool.
          releaseOnce(err as Error);
          throw err;
        }
      },
      async rollback(): Promise<void> {
        if (released) throw new Error("Transaction already finalized");
        try {
          await client.query("ROLLBACK");
          releaseOnce();
        } catch (err) {
          releaseOnce(err as Error);
          throw err;
        }
      },
    };
  }
}
