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
      .mockResolvedValueOnce({ rows: [{ "QUERY PLAN": "Seq Scan on t" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await makeConnector({ query, release }).explain("SELECT 1", false);

    expect(res.plan).toBe("Seq Scan on t");
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION READ ONLY");
    expect(query).toHaveBeenNthCalledWith(2, "EXPLAIN SELECT 1");
    expect(query).toHaveBeenNthCalledWith(3, "COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases when EXPLAIN ANALYZE fails", async () => {
    const release = vi.fn();
    const err = new Error("boom");
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(err).mockResolvedValueOnce({});

    await expect(makeConnector({ query, release }).explain("SELECT 1", true)).rejects.toThrow("boom");
    expect(query).toHaveBeenNthCalledWith(2, "EXPLAIN ANALYZE SELECT 1");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
