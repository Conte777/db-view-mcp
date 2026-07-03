import * as clickhouseClient from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import type { ClickHouseConfig } from "../../src/config/types.js";
import { ClickHouseConnector } from "../../src/connectors/clickhouse.js";

const config: ClickHouseConfig = {
  id: "ch",
  type: "clickhouse",
  url: "http://localhost:8123",
  database: "analytics",
  user: "default",
  password: "",
};

type Stub = { query: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn>; ping: ReturnType<typeof vi.fn> };

function makeConnector(stub: Partial<Stub> = {}) {
  const connector = new ClickHouseConnector(config, 30000, 100);
  const client: Stub = {
    query: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue({ success: true }),
    ...stub,
  };
  (connector as unknown as { client: unknown }).client = client;
  return { connector, client };
}

function jsonResult(rows: unknown[]) {
  return { json: vi.fn().mockResolvedValue(rows) };
}

describe("ClickHouseConnector.query", () => {
  it("ignores params, wraps readonly and sets JSONEachRow + readonly:1", async () => {
    const { connector, client } = makeConnector({ query: vi.fn().mockResolvedValue(jsonResult([{ n: 1 }])) });
    const res = await connector.query("SELECT n FROM t", ["ignored"], 25);
    expect(res).toEqual({ rows: [{ n: 1 }], rowCount: 1 });
    const arg = client.query.mock.calls[0][0];
    expect(arg.format).toBe("JSONEachRow");
    expect(arg.clickhouse_settings).toEqual({ readonly: "1" });
    expect(arg.query).toBe("SELECT * FROM (SELECT n FROM t) AS _q LIMIT 25");
    expect(arg.query_params).toBeUndefined();
  });

  it("falls back to the configured maxRows when omitted", async () => {
    const { connector, client } = makeConnector({ query: vi.fn().mockResolvedValue(jsonResult([])) });
    await connector.query("SELECT 1");
    expect(client.query.mock.calls[0][0].query).toContain("LIMIT 100");
  });

  it("throws 'Not connected' before connect()", async () => {
    await expect(new ClickHouseConnector(config, 30000, 100).query("SELECT 1")).rejects.toThrow("Not connected");
  });
});

describe("ClickHouseConnector.execute", () => {
  it("issues a command and always returns an empty result", async () => {
    const { connector, client } = makeConnector();
    const res = await connector.execute("ALTER TABLE t DELETE WHERE 1", ["x"]);
    expect(client.command).toHaveBeenCalledWith({ query: "ALTER TABLE t DELETE WHERE 1" });
    expect(res).toEqual({ rows: [], rowCount: 0 });
  });
});

describe("ClickHouseConnector.listTables", () => {
  it("maps a View engine to 'view' and everything else to 'table'", async () => {
    const { connector } = makeConnector({
      query: vi.fn().mockResolvedValue(
        jsonResult([
          { name: "events", engine: "MergeTree" },
          { name: "events_mv", engine: "MaterializedView" },
        ]),
      ),
    });
    expect(await connector.listTables()).toEqual([
      { schema: "analytics", name: "events", type: "table" },
      { schema: "analytics", name: "events_mv", type: "view" },
    ]);
  });
});

describe("ClickHouseConnector.describeTable", () => {
  it("detects nullable via the Nullable prefix and PK via is_in_primary_key", async () => {
    const { connector, client } = makeConnector({
      query: vi.fn().mockResolvedValue(
        jsonResult([
          { name: "id", type: "UInt64", default_kind: "", default_expression: "", is_in_primary_key: 1 },
          { name: "note", type: "Nullable(String)", default_kind: "", default_expression: "''", is_in_primary_key: 0 },
        ]),
      ),
    });
    const cols = await connector.describeTable("events");
    expect(client.query.mock.calls[0][0].query_params).toEqual({ table: "events" });
    expect(cols).toEqual([
      { name: "id", type: "UInt64", nullable: false, defaultValue: null, isPrimaryKey: true },
      { name: "note", type: "Nullable(String)", nullable: true, defaultValue: "''", isPrimaryKey: false },
    ]);
  });
});

describe("ClickHouseConnector.getSchema", () => {
  it("joins create_table_query values", async () => {
    const { connector } = makeConnector({
      query: vi.fn().mockResolvedValue(
        jsonResult([
          { name: "a", create_table_query: "CREATE TABLE a (...)" },
          { name: "b", create_table_query: "CREATE TABLE b (...)" },
        ]),
      ),
    });
    expect(await connector.getSchema()).toBe("CREATE TABLE a (...);\n\nCREATE TABLE b (...)");
  });
});

describe("ClickHouseConnector.explain", () => {
  it("prefixes EXPLAIN and joins plan lines", async () => {
    const { connector, client } = makeConnector({
      query: vi.fn().mockResolvedValue(jsonResult([{ explain: "line1" }, { explain: "line2" }])),
    });
    const res = await connector.explain("SELECT 1");
    expect(client.query.mock.calls[0][0].query).toBe("EXPLAIN SELECT 1");
    expect(res.plan).toBe("line1\nline2");
  });

  it("uses EXPLAIN ANALYZE when analyze is true", async () => {
    const { connector, client } = makeConnector({
      query: vi.fn().mockResolvedValue(jsonResult([{ explain: "x" }])),
    });
    await connector.explain("SELECT 1", true);
    expect(client.query.mock.calls[0][0].query).toBe("EXPLAIN ANALYZE SELECT 1");
  });
});

describe("ClickHouseConnector.beginTransaction", () => {
  it("throws — transactions are unsupported", async () => {
    const { connector } = makeConnector();
    await expect(connector.beginTransaction()).rejects.toThrow("Transactions are not supported in ClickHouse");
  });
});

describe("ClickHouseConnector.disconnect", () => {
  it("closes the client", async () => {
    const connector = new ClickHouseConnector(config, 30000, 100);
    const close = vi.fn().mockResolvedValue(undefined);
    (connector as unknown as { client: unknown }).client = { close };
    await connector.disconnect();
    expect(close).toHaveBeenCalledOnce();
  });

  it("is a no-op when never connected", async () => {
    await expect(new ClickHouseConnector(config, 30000, 100).disconnect()).resolves.toBeUndefined();
  });
});

describe("ClickHouseConnector.connect", () => {
  it("creates a client without TLS and pings", async () => {
    const ping = vi.fn().mockResolvedValue({ success: true });
    const spy = vi
      .spyOn(clickhouseClient, "createClient")
      .mockReturnValue({ ping } as unknown as ReturnType<typeof clickhouseClient.createClient>);
    await new ClickHouseConnector(config, 30000, 100).connect();
    const opts = spy.mock.calls[0][0]!;
    expect(opts.url).toBe("http://localhost:8123");
    expect(opts.tls).toBeUndefined();
    expect(ping).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("passes inline TLS CA and reject flag when configured", async () => {
    const ping = vi.fn().mockResolvedValue({ success: true });
    const spy = vi
      .spyOn(clickhouseClient, "createClient")
      .mockReturnValue({ ping } as unknown as ReturnType<typeof clickhouseClient.createClient>);
    const cfg: ClickHouseConfig = { ...config, tls: { ca: "-----BEGIN CERT-----", rejectUnauthorized: false } };
    await new ClickHouseConnector(cfg, 30000, 100).connect();
    const tls = spy.mock.calls[0][0]!.tls as unknown as { reject_unauthorized: boolean };
    expect(tls.reject_unauthorized).toBe(false);
    spy.mockRestore();
  });
});
