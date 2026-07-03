import { describe, expect, it, vi } from "vitest";
import type { ResolvedDatabaseConfig } from "../../src/config/types.js";
import { ConnectorManager } from "../../src/connectors/manager.js";
import { listDatabasesHandler } from "../../src/tools/readonly/list-databases.js";

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

const configs: ResolvedDatabaseConfig[] = [
  {
    id: "pg",
    type: "postgresql",
    host: "h",
    port: 5432,
    database: "d",
    user: "u",
    password: "",
    sslRejectUnauthorized: true,
    description: "primary",
    lazyConnection: true,
    maxRows: 100,
    queryTimeout: 30000,
  },
  {
    id: "ch",
    type: "clickhouse",
    url: "http://x",
    database: "a",
    user: "default",
    password: "",
    lazyConnection: true,
    maxRows: 100,
    queryTimeout: 30000,
  },
];

describe("listDatabasesHandler", () => {
  it("maps configs to id/type/description without connecting", async () => {
    const manager = new ConnectorManager(configs);
    const acquireSpy = vi.spyOn(manager, "acquire");
    const body = parse(await listDatabasesHandler(manager)());
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      { id: "pg", type: "postgresql", description: "primary" },
      { id: "ch", type: "clickhouse", description: "" },
    ]);
    expect(acquireSpy).not.toHaveBeenCalled();
  });
});
