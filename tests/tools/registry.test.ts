import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Defaults, ResolvedDatabaseConfig } from "../../src/config/types.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { registerTools } from "../../src/tools/registry.js";

function makeServer() {
  const tool = vi.fn();
  return { server: { tool } as unknown as McpServer, tool };
}

const defaults: Defaults = {
  maxRows: 100,
  lazyConnection: true,
  toolsPerDatabase: false,
  queryTimeout: 30000,
  logLevel: "info",
  rowFormat: "json",
};

const configs: ResolvedDatabaseConfig[] = [
  {
    id: "main_pg",
    type: "postgresql",
    host: "h",
    port: 5432,
    database: "d",
    user: "u",
    password: "",
    sslRejectUnauthorized: true,
    description: "Primary",
    lazyConnection: true,
    maxRows: 100,
    queryTimeout: 30000,
  },
];

describe("registerTools parameter mode", () => {
  it("registers exactly the 9 global tools", () => {
    const { server, tool } = makeServer();
    registerTools(server, new ConnectorManager(configs), defaults);
    expect(tool.mock.calls.map((c) => c[0])).toEqual([
      "query",
      "list_databases",
      "list_tables",
      "describe_table",
      "schema",
      "explain_query",
      "performance",
      "execute",
      "transaction",
    ]);
  });
});

describe("registerTools per-database mode", () => {
  it("suffixes tool names per db and keeps list_databases global", () => {
    const { server, tool } = makeServer();
    registerTools(server, new ConnectorManager(configs), { ...defaults, toolsPerDatabase: true });
    const names = tool.mock.calls.map((c) => c[0]);
    expect(names).toContain("query_main_pg");
    expect(names).toContain("transaction_main_pg");
    expect(names).toContain("list_databases");
    expect(names).not.toContain("query");
  });

  it("injects the fixed database id into the per-db handler", async () => {
    const { server, tool } = makeServer();
    const manager = new ConnectorManager(configs);
    const acquireSpy = vi.spyOn(manager, "acquire").mockRejectedValue(new Error("stop"));
    registerTools(server, manager, { ...defaults, toolsPerDatabase: true });
    const handler = tool.mock.calls.find((c) => c[0] === "query_main_pg")![3] as (p: unknown) => Promise<unknown>;
    await handler({ sql: "SELECT 1" });
    expect(acquireSpy).toHaveBeenCalledWith("main_pg");
  });

  it("appends the config description to the tool description", () => {
    const { server, tool } = makeServer();
    registerTools(server, new ConnectorManager(configs), { ...defaults, toolsPerDatabase: true });
    const queryCall = tool.mock.calls.find((c) => c[0] === "query_main_pg")!;
    expect(queryCall[1]).toContain("(Primary)");
  });
});
