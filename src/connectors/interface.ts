export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface TableInfo {
  schema: string;
  name: string;
  type: string; // "table" | "view"
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface ExplainResult {
  plan: string;
}

export interface TransactionHandle {
  id: string;
  execute(sql: string, params?: string[]): Promise<QueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Connector {
  readonly type: "postgresql" | "clickhouse";

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  query(sql: string, params?: string[], maxRows?: number): Promise<QueryResult>;
  execute(sql: string, params?: string[]): Promise<QueryResult>;

  listTables(schema?: string): Promise<TableInfo[]>;
  describeTable(table: string, schema?: string): Promise<ColumnInfo[]>;
  getSchema(schema?: string): Promise<string>;

  explain(sql: string, analyze?: boolean): Promise<ExplainResult>;

  beginTransaction(): Promise<TransactionHandle>;
}
