import type {
  Connector,
  QueryResult,
  TableInfo,
  ColumnInfo,
  ExplainResult,
  TransactionHandle,
} from "./interface.js";
import type { PerformanceTracker } from "../tools/readonly/performance.js";

export class InstrumentedConnector implements Connector {
  readonly type: "postgresql" | "clickhouse";

  constructor(
    private inner: Connector,
    private tracker: PerformanceTracker,
    private dbId: string,
  ) {
    this.type = inner.type;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  async query(sql: string, params?: string[], maxRows?: number): Promise<QueryResult> {
    const start = performance.now();
    try {
      return await this.inner.query(sql, params, maxRows);
    } finally {
      this.tracker.recordQuery(sql, performance.now() - start, this.dbId);
    }
  }

  async execute(sql: string, params?: string[]): Promise<QueryResult> {
    const start = performance.now();
    try {
      return await this.inner.execute(sql, params);
    } finally {
      this.tracker.recordQuery(sql, performance.now() - start, this.dbId);
    }
  }

  listTables(schema?: string): Promise<TableInfo[]> {
    return this.inner.listTables(schema);
  }

  describeTable(table: string, schema?: string): Promise<ColumnInfo[]> {
    return this.inner.describeTable(table, schema);
  }

  getSchema(schema?: string): Promise<string> {
    return this.inner.getSchema(schema);
  }

  explain(sql: string, analyze?: boolean): Promise<ExplainResult> {
    return this.inner.explain(sql, analyze);
  }

  beginTransaction(): Promise<TransactionHandle> {
    return this.inner.beginTransaction();
  }
}
