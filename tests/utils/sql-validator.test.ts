import { describe, expect, it } from "vitest";
import { validateReadonlySql, wrapReadonlyQuery } from "../../src/utils/sql-validator.js";

describe("validateReadonlySql", () => {
  describe("valid queries", () => {
    it("accepts simple SELECT", () => {
      expect(validateReadonlySql("SELECT * FROM users")).toMatchObject({ valid: true });
    });

    it("accepts SELECT with subquery", () => {
      expect(validateReadonlySql("SELECT * FROM (SELECT id FROM users) AS sub")).toMatchObject({ valid: true });
    });

    it("accepts CTE", () => {
      expect(validateReadonlySql("WITH cte AS (SELECT 1) SELECT * FROM cte")).toMatchObject({ valid: true });
    });

    it("accepts SELECT with trailing semicolon", () => {
      expect(validateReadonlySql("SELECT 1;")).toMatchObject({ valid: true });
    });

    it("does not false-positive on 'updated_at' column", () => {
      expect(validateReadonlySql("SELECT updated_at FROM users")).toMatchObject({ valid: true });
    });

    it("does not false-positive on 'deleted' column", () => {
      expect(validateReadonlySql("SELECT deleted FROM users WHERE deleted = false")).toMatchObject({ valid: true });
    });

    it("does not false-positive on 'created_at' column", () => {
      expect(validateReadonlySql("SELECT created_at FROM users")).toMatchObject({ valid: true });
    });

    it("does not false-positive on 'is_replaced' column", () => {
      expect(validateReadonlySql("SELECT is_replaced FROM items")).toMatchObject({ valid: true });
    });

    it("does not false-positive on string literals containing keywords", () => {
      expect(validateReadonlySql("SELECT * FROM users WHERE status = 'INSERT'")).toMatchObject({ valid: true });
    });

    it("does not false-positive on string literal with semicolon", () => {
      expect(validateReadonlySql("SELECT * FROM users WHERE name = 'foo;bar'")).toMatchObject({ valid: true });
    });

    it("accepts EXPLAIN-like column names", () => {
      expect(validateReadonlySql("SELECT grant_type FROM oauth_tokens")).toMatchObject({ valid: true });
    });
  });

  describe("blocked queries", () => {
    it("blocks INSERT", () => {
      const result = validateReadonlySql("INSERT INTO users (name) VALUES ('test')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("INSERT");
    });

    it("blocks UPDATE", () => {
      const result = validateReadonlySql("UPDATE users SET name = 'test'");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("UPDATE");
    });

    it("blocks DELETE", () => {
      const result = validateReadonlySql("DELETE FROM users");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("DELETE");
    });

    it("blocks DROP", () => {
      const result = validateReadonlySql("DROP TABLE users");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("DROP");
    });

    it("blocks TRUNCATE", () => {
      const result = validateReadonlySql("TRUNCATE TABLE users");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("TRUNCATE");
    });

    it("blocks ALTER", () => {
      const result = validateReadonlySql("ALTER TABLE users ADD COLUMN age int");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("ALTER");
    });

    it("blocks CREATE", () => {
      const result = validateReadonlySql("CREATE TABLE evil (id int)");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("CREATE");
    });

    it("blocks GRANT", () => {
      const result = validateReadonlySql("GRANT ALL ON users TO attacker");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("GRANT");
    });

    it("blocks REVOKE", () => {
      const result = validateReadonlySql("REVOKE ALL ON users FROM admin");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("REVOKE");
    });

    it("blocks COPY", () => {
      const result = validateReadonlySql("COPY users TO '/tmp/dump.csv'");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("COPY");
    });

    it("blocks CALL", () => {
      const result = validateReadonlySql("CALL dangerous_procedure()");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("CALL");
    });

    it("blocks MERGE", () => {
      const result = validateReadonlySql(
        "MERGE INTO users USING source ON users.id = source.id WHEN MATCHED THEN UPDATE SET name = source.name",
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("MERGE");
    });

    it("blocks empty SQL", () => {
      const result = validateReadonlySql("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Empty");
    });

    it("blocks whitespace-only SQL", () => {
      const result = validateReadonlySql("   ");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Empty");
    });
  });

  describe("bypass attempts", () => {
    it("blocks CTE with INSERT", () => {
      const result = validateReadonlySql("WITH cte AS (SELECT 1) INSERT INTO users (id) SELECT * FROM cte");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("INSERT");
    });

    it("blocks comment-hidden INSERT (block comment)", () => {
      const result = validateReadonlySql("SELECT 1; /* */ INSERT INTO users VALUES (1)");
      expect(result.valid).toBe(false);
    });

    it("blocks comment-hidden INSERT (line comment)", () => {
      const result = validateReadonlySql("SELECT 1; -- comment\nINSERT INTO users VALUES (1)");
      expect(result.valid).toBe(false);
    });

    it("blocks INSERT inside subquery context", () => {
      const result = validateReadonlySql("SELECT * FROM (INSERT INTO users VALUES (1) RETURNING *) AS t");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("INSERT");
    });

    it("blocks multi-statement attacks", () => {
      const result = validateReadonlySql("SELECT 1; DROP TABLE users");
      expect(result.valid).toBe(false);
    });

    it("blocks DELETE hidden after SELECT in multi-statement", () => {
      const result = validateReadonlySql("SELECT 1; DELETE FROM users");
      expect(result.valid).toBe(false);
    });

    it("blocks REPLACE", () => {
      const result = validateReadonlySql("REPLACE INTO users (id, name) VALUES (1, 'test')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("REPLACE");
    });
  });

  describe("normalizedSql", () => {
    it("strips a trailing semicolon", () => {
      const result = validateReadonlySql("SELECT 1;");
      expect(result.valid).toBe(true);
      expect(result.normalizedSql).toBe("SELECT 1");
    });

    it("strips a trailing line comment together with the trailing semicolon", () => {
      const result = validateReadonlySql("SELECT 1; -- comment");
      expect(result.valid).toBe(true);
      expect(result.normalizedSql).toBe("SELECT 1");
    });

    it("preserves string literals containing '--'", () => {
      const result = validateReadonlySql("SELECT '--not a comment' FROM t");
      expect(result.valid).toBe(true);
      expect(result.normalizedSql).toBe("SELECT '--not a comment' FROM t");
    });

    it("removes a trailing multiline block comment", () => {
      const result = validateReadonlySql("SELECT 1 FROM t /* trailing\nmultiline\ncomment */");
      expect(result.valid).toBe(true);
      expect(result.normalizedSql).toBe("SELECT 1 FROM t");
    });

    it("does not leak __STR__/__ID__ placeholders", () => {
      const result = validateReadonlySql("SELECT 'value' AS \"col\"");
      expect(result.valid).toBe(true);
      expect(result.normalizedSql).not.toContain("__STR__");
      expect(result.normalizedSql).not.toContain("__ID__");
      expect(result.normalizedSql).toBe("SELECT 'value' AS \"col\"");
    });
  });

  describe("deny-list", () => {
    it("blocks pg_terminate_backend", () => {
      const result = validateReadonlySql("SELECT pg_terminate_backend(123)");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("pg_terminate_backend");
    });

    it("blocks pg_read_file", () => {
      const result = validateReadonlySql("SELECT pg_read_file('/etc/passwd')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("pg_read_file");
    });

    it("blocks the ClickHouse url() table function", () => {
      const result = validateReadonlySql("SELECT * FROM url('http://x')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("url");
    });

    it("allows a table literally named file_uploads (not a function call)", () => {
      const result = validateReadonlySql("SELECT * FROM file_uploads");
      expect(result.valid).toBe(true);
    });

    it("allows a column named my_url (not a function call, no boundary before 'url')", () => {
      const result = validateReadonlySql("SELECT my_url FROM t");
      expect(result.valid).toBe(true);
    });

    it("blocks PG_SLEEP case-insensitively", () => {
      const result = validateReadonlySql("select PG_SLEEP(1)");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("PG_SLEEP");
    });

    it("does not block current_setting (safe function)", () => {
      const result = validateReadonlySql("SELECT current_setting('server_version')");
      expect(result.valid).toBe(true);
    });

    it("blocks a double-quoted denied function call", () => {
      const result = validateReadonlySql('SELECT "pg_terminate_backend"(1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain("pg_terminate_backend");
    });

    it("blocks a schema-qualified double-quoted denied function call", () => {
      const result = validateReadonlySql("SELECT pg_catalog.\"pg_read_file\"('/etc/passwd')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("pg_read_file");
    });

    it("blocks a double-quoted ClickHouse url() table function", () => {
      const result = validateReadonlySql("SELECT * FROM \"url\"('http://evil','CSV','x String')");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("url");
    });

    it("still allows a plainly-quoted identifier that is not a denied call", () => {
      const result = validateReadonlySql('SELECT "select" FROM "my table"');
      expect(result.valid).toBe(true);
    });

    it.each([
      "pg_ls_logdir",
      "pg_ls_waldir",
      "pg_ls_tmpdir",
      "pg_ls_archive_statusdir",
      "pg_file_write",
      "pg_file_rename",
      "pg_file_unlink",
      "dblink_connect_u",
      "dblink_send_query",
      "dblink_open",
      "dblink_fetch",
      "dblink_close",
    ])("blocks %s", (fn) => {
      const result = validateReadonlySql(`SELECT ${fn}('x')`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(fn);
    });
  });

  describe("wrapReadonlyQuery", () => {
    it("wraps with a row limit (postgresql)", () => {
      expect(wrapReadonlyQuery("SELECT 1", 10, "postgresql")).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 10");
    });

    it("wraps with a row limit (clickhouse)", () => {
      expect(wrapReadonlyQuery("SELECT 1", 5, "clickhouse")).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 5");
    });

    it("strips a trailing semicolon before wrapping", () => {
      expect(wrapReadonlyQuery("SELECT 1;", 10, "postgresql")).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 10");
    });

    it("handles input ending in a line comment (D2 regression case)", () => {
      expect(wrapReadonlyQuery("SELECT 1; -- c", 10, "postgresql")).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 10");
    });

    it("is idempotent on already-normalized sql", () => {
      const normalized = validateReadonlySql("SELECT 1; -- c").normalizedSql!;
      expect(wrapReadonlyQuery(normalized, 10, "postgresql")).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 10");
    });
  });
});
