import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectorManager } from "../connectors/manager.js";
import type { Defaults } from "../config/types.js";

import { createQueryToolParams, queryToolHandler } from "./readonly/query.js";
import { listDatabasesHandler } from "./readonly/list-databases.js";
import { createListTablesParams, listTablesHandler } from "./readonly/list-tables.js";
import { createDescribeTableParams, describeTableHandler } from "./readonly/describe-table.js";
import { createSchemaParams, schemaHandler } from "./readonly/schema.js";
import { createExplainParams, explainHandler } from "./readonly/explain.js";
import { createPerformanceParams, performanceHandler } from "./readonly/performance.js";
import { createExecuteParams, executeHandler } from "./write/execute.js";
import { createTransactionParams, transactionHandler } from "./write/transaction.js";

export function registerTools(server: McpServer, manager: ConnectorManager, defaults: Defaults) {
  const dbIds = manager.getDatabaseIds();

  if (defaults.toolsPerDatabase) {
    registerPerDatabaseTools(server, manager, dbIds);
  } else {
    registerParameterTools(server, manager, dbIds);
  }
}

function registerParameterTools(server: McpServer, manager: ConnectorManager, dbIds: string[]) {
  server.tool(
    "query",
    `Execute a read-only SQL query. Available databases: ${dbIds.join(", ")}`,
    createQueryToolParams(dbIds),
    queryToolHandler(manager),
  );

  server.tool("list_databases", "List all configured databases", {}, listDatabasesHandler(manager));

  server.tool(
    "list_tables",
    `List tables in a database. Available databases: ${dbIds.join(", ")}`,
    createListTablesParams(dbIds),
    listTablesHandler(manager),
  );

  server.tool(
    "describe_table",
    `Describe table structure. Available databases: ${dbIds.join(", ")}`,
    createDescribeTableParams(dbIds),
    describeTableHandler(manager),
  );

  server.tool(
    "schema",
    `Get full database schema (DDL). Available databases: ${dbIds.join(", ")}`,
    createSchemaParams(dbIds),
    schemaHandler(manager),
  );

  server.tool(
    "explain_query",
    `Run EXPLAIN ANALYZE on a query. Available databases: ${dbIds.join(", ")}`,
    createExplainParams(dbIds),
    explainHandler(manager),
  );

  server.tool(
    "performance",
    `View performance metrics and slow queries. Available databases: ${dbIds.join(", ")}`,
    createPerformanceParams(dbIds),
    performanceHandler(manager),
  );

  server.tool(
    "execute",
    `Execute a write SQL statement (INSERT, UPDATE, DELETE, DDL). Available databases: ${dbIds.join(", ")}`,
    createExecuteParams(dbIds),
    executeHandler(manager),
  );

  server.tool(
    "transaction",
    `Manage database transactions (begin, execute, commit, rollback). Available databases: ${dbIds.join(", ")}`,
    createTransactionParams(dbIds),
    transactionHandler(manager),
  );
}

function registerPerDatabaseTools(server: McpServer, manager: ConnectorManager, dbIds: string[]) {
  for (const dbId of dbIds) {
    const singleDbIds = [dbId];
    const config = manager.getConfig(dbId)!;
    const desc = config.description ? ` (${config.description})` : "";

    server.tool(
      `query_${dbId}`,
      `Execute a read-only SQL query on ${dbId}${desc}`,
      { sql: createQueryToolParams(singleDbIds).sql, maxRows: createQueryToolParams(singleDbIds).maxRows },
      async (params) => queryToolHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `list_tables_${dbId}`,
      `List tables on ${dbId}${desc}`,
      { schema: createListTablesParams(singleDbIds).schema },
      async (params) => listTablesHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `describe_table_${dbId}`,
      `Describe table structure on ${dbId}${desc}`,
      { table: createDescribeTableParams(singleDbIds).table, schema: createDescribeTableParams(singleDbIds).schema },
      async (params) => describeTableHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `schema_${dbId}`,
      `Get full schema of ${dbId}${desc}`,
      { schema: createSchemaParams(singleDbIds).schema },
      async (params) => schemaHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `explain_query_${dbId}`,
      `Run EXPLAIN on ${dbId}${desc}`,
      { sql: createExplainParams(singleDbIds).sql, analyze: createExplainParams(singleDbIds).analyze },
      async (params) => explainHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `performance_${dbId}`,
      `Performance metrics for ${dbId}${desc}`,
      {
        action: createPerformanceParams(singleDbIds).action,
        threshold: createPerformanceParams(singleDbIds).threshold,
        limit: createPerformanceParams(singleDbIds).limit,
      },
      async (params) => performanceHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `execute_${dbId}`,
      `Execute write SQL on ${dbId}${desc}`,
      { statement: createExecuteParams(singleDbIds).statement, params: createExecuteParams(singleDbIds).params },
      async (params) => executeHandler(manager)({ database: dbId, ...params }),
    );

    server.tool(
      `transaction_${dbId}`,
      `Manage transactions on ${dbId}${desc}`,
      {
        action: createTransactionParams(singleDbIds).action,
        transactionId: createTransactionParams(singleDbIds).transactionId,
        statement: createTransactionParams(singleDbIds).statement,
        params: createTransactionParams(singleDbIds).params,
      },
      async (params) => transactionHandler(manager)({ database: dbId, ...params }),
    );
  }

  // list_databases is always global
  server.tool("list_databases", "List all configured databases", {}, listDatabasesHandler(manager));
}
