import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { PostgresConfig } from "../../src/config/types.js";
import { PostgresConnector } from "../../src/connectors/postgresql.js";

const config: PostgresConfig = {
  id: "pg",
  type: "postgresql",
  host: "localhost",
  port: 5432,
  database: "testdb",
  user: "user",
  password: "",
  sslRejectUnauthorized: true,
};

function makeConnector(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  const connector = new PostgresConnector(config, 30000, 100);
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  (connector as unknown as { pool: unknown }).pool = pool;
  return connector;
}

// Pool-direct methods (execute/listTables/describeTable/getSchema) call getPool().query() rather
// than checking out a client, so this variant stubs the pool's own query.
function makePoolConnector(poolQuery: ReturnType<typeof vi.fn>) {
  const connector = new PostgresConnector(config, 30000, 100);
  (connector as unknown as { pool: unknown }).pool = { query: poolQuery, end: vi.fn().mockResolvedValue(undefined) };
  return connector;
}

describe("PostgresConnector.beginTransaction", () => {
  it("releases the pooled client exactly once on commit and blocks re-finalization", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const tx = await makeConnector({ query, release }).beginTransaction();

    await tx.commit();
    expect(release).toHaveBeenCalledTimes(1);

    await expect(tx.commit()).rejects.toThrow("already finalized");
    await expect(tx.rollback()).rejects.toThrow("already finalized");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the pooled client exactly once on rollback", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const tx = await makeConnector({ query, release }).beginTransaction();

    await tx.rollback();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hands the client back with the error when COMMIT itself fails", async () => {
    const release = vi.fn();
    const err = new Error("connection reset");
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(err);
    const tx = await makeConnector({ query, release }).beginTransaction();

    await expect(tx.commit()).rejects.toThrow("connection reset");
    expect(release).toHaveBeenCalledWith(err);
  });
});

describe("PostgresConnector.explain", () => {
  it("wraps EXPLAIN in a READ ONLY transaction and releases the client", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ "QUERY PLAN": "Seq Scan on t" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await makeConnector({ query, release }).explain("SELECT 1", false);

    expect(res.plan).toBe("Seq Scan on t");
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION READ ONLY");
    expect(query).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = 30000");
    expect(query).toHaveBeenNthCalledWith(3, "EXPLAIN SELECT 1");
    expect(query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases when EXPLAIN ANALYZE fails", async () => {
    const release = vi.fn();
    const err = new Error("boom");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({});

    await expect(makeConnector({ query, release }).explain("SELECT 1", true)).rejects.toThrow("boom");
    expect(query).toHaveBeenNthCalledWith(3, "EXPLAIN ANALYZE SELECT 1");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("PostgresConnector.query", () => {
  it("wraps in a READ ONLY txn, applies the LIMIT and returns rows", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
      .mockResolvedValueOnce({ rows: [{ a: 1 }] }) // wrapped select
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const res = await makeConnector({ query, release }).query("SELECT a FROM t", ["p"], 25);
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION READ ONLY");
    expect(query).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = 30000");
    expect(query).toHaveBeenNthCalledWith(3, "SELECT * FROM (SELECT a FROM t) AS _q LIMIT 25", ["p"]);
    expect(query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(res).toEqual({ rows: [{ a: 1 }], rowCount: 1 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back to the configured maxRows when omitted", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await makeConnector({ query, release }).query("SELECT 1");
    expect(query).toHaveBeenNthCalledWith(3, "SELECT * FROM (SELECT 1) AS _q LIMIT 100", undefined);
  });

  it("rolls back and rethrows on a query error", async () => {
    const release = vi.fn();
    const err = new Error("boom");
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(err).mockResolvedValueOnce({});
    await expect(makeConnector({ query, release }).query("SELECT 1")).rejects.toThrow("boom");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("throws 'Not connected' before connect()", async () => {
    await expect(new PostgresConnector(config, 30000, 100).query("SELECT 1")).rejects.toThrow("Not connected");
  });
});

describe("PostgresConnector pool-direct reads", () => {
  it("execute runs directly on the pool and returns rows/rowCount", async () => {
    const poolQuery = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const res = await makePoolConnector(poolQuery).execute("INSERT INTO t VALUES ($1)", ["x"]);
    expect(poolQuery).toHaveBeenCalledWith("INSERT INTO t VALUES ($1)", ["x"]);
    expect(res).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it("execute normalizes null rows/rowCount from the driver", async () => {
    const poolQuery = vi.fn().mockResolvedValue({ rows: undefined, rowCount: null });
    expect(await makePoolConnector(poolQuery).execute("DELETE FROM t")).toEqual({ rows: [], rowCount: 0 });
  });

  it("listTables maps BASE TABLE to table, others to view, defaulting schema to public", async () => {
    const poolQuery = vi.fn().mockResolvedValue({
      rows: [
        { table_schema: "public", table_name: "t", table_type: "BASE TABLE" },
        { table_schema: "public", table_name: "v", table_type: "VIEW" },
      ],
    });
    const res = await makePoolConnector(poolQuery).listTables();
    expect(poolQuery.mock.calls[0][1]).toEqual(["public"]);
    expect(res).toEqual([
      { schema: "public", name: "t", type: "table" },
      { schema: "public", name: "v", type: "view" },
    ]);
  });

  it("listTables forwards an explicit schema", async () => {
    const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
    await makePoolConnector(poolQuery).listTables("app");
    expect(poolQuery.mock.calls[0][1]).toEqual(["app"]);
  });

  it("describeTable maps nullability and primary-key flags", async () => {
    const poolQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
          column_default: "nextval('s')",
          is_primary_key: true,
        },
        { column_name: "name", data_type: "text", is_nullable: "YES", column_default: null, is_primary_key: false },
      ],
    });
    const res = await makePoolConnector(poolQuery).describeTable("users", "app");
    expect(poolQuery.mock.calls[0][1]).toEqual(["users", "app"]);
    expect(res).toEqual([
      { name: "id", type: "integer", nullable: false, defaultValue: "nextval('s')", isPrimaryKey: true },
      { name: "name", type: "text", nullable: true, defaultValue: null, isPrimaryKey: false },
    ]);
  });

  it("getSchema renders CREATE TABLE blocks grouped by table", async () => {
    const poolQuery = vi.fn().mockResolvedValue({
      rows: [
        { table_name: "t", column_name: "id", data_type: "integer", is_nullable: "NO", column_default: null },
        { table_name: "t", column_name: "note", data_type: "text", is_nullable: "YES", column_default: "'x'" },
      ],
    });
    const ddl = await makePoolConnector(poolQuery).getSchema();
    expect(ddl).toContain("CREATE TABLE t (");
    expect(ddl).toContain("  id integer NOT NULL");
    expect(ddl).toContain("  note text NULL DEFAULT 'x'");
  });
});

describe("PostgresConnector.disconnect", () => {
  it("ends the pool and reports Not connected afterwards", async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const connector = new PostgresConnector(config, 30000, 100);
    (connector as unknown as { pool: unknown }).pool = { end };
    await connector.disconnect();
    expect(end).toHaveBeenCalledOnce();
    await expect(connector.execute("SELECT 1")).rejects.toThrow("Not connected");
  });

  it("is a no-op when never connected", async () => {
    await expect(new PostgresConnector(config, 30000, 100).disconnect()).resolves.toBeUndefined();
  });
});

describe("PostgresConnector.beginTransaction execute path", () => {
  it("runs statements on the pinned client and normalizes rowCount", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ a: 1 }], rowCount: 1 }); // execute
    const tx = await makeConnector({ query, release }).beginTransaction();
    expect(await tx.execute("SELECT a", ["p"])).toEqual({ rows: [{ a: 1 }], rowCount: 1 });
    expect(query).toHaveBeenLastCalledWith("SELECT a", ["p"]);
  });

  it("rejects execute after the transaction is finalized", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const tx = await makeConnector({ query, release }).beginTransaction();
    await tx.commit();
    await expect(tx.execute("SELECT 1")).rejects.toThrow("already finalized");
  });

  it("releases the client and rethrows when BEGIN itself fails", async () => {
    const release = vi.fn();
    const query = vi.fn().mockRejectedValueOnce(new Error("begin failed"));
    await expect(makeConnector({ query, release }).beginTransaction()).rejects.toThrow("begin failed");
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("PostgresConnector.connect", () => {
  it("builds a host-based pool and verifies connectivity", async () => {
    const release = vi.fn();
    const fakePool = { connect: vi.fn().mockResolvedValue({ release }) };
    const poolSpy = vi.spyOn(pg, "Pool").mockImplementation(() => fakePool as unknown as pg.Pool);
    await new PostgresConnector(config, 30000, 100).connect();
    const opts = poolSpy.mock.calls[0][0]!;
    expect(opts.host).toBe("localhost");
    expect(opts.query_timeout).toBe(30000);
    expect(opts.statement_timeout).toBeUndefined();
    expect(fakePool.connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    poolSpy.mockRestore();
  });

  it("uses a connectionString with inline SSL CA when provided", async () => {
    const release = vi.fn();
    const fakePool = { connect: vi.fn().mockResolvedValue({ release }) };
    const poolSpy = vi.spyOn(pg, "Pool").mockImplementation(() => fakePool as unknown as pg.Pool);
    const cfg: PostgresConfig = {
      ...config,
      connectionString: "postgres://x",
      ssl: true,
      sslCa: "-----BEGIN CERT-----",
    };
    await new PostgresConnector(cfg, 30000, 100).connect();
    const opts = poolSpy.mock.calls[0][0]!;
    expect(opts.connectionString).toBe("postgres://x");
    expect(opts.ssl).toEqual({ rejectUnauthorized: true, ca: "-----BEGIN CERT-----" });
    poolSpy.mockRestore();
  });
});
