import { describe, it, expect } from "vitest";
import { validateReadonlySql } from "../../src/utils/sql-validator.js";

describe("validateReadonlySql", () => {
  describe("valid queries", () => {
    it("accepts simple SELECT", () => {
      expect(validateReadonlySql("SELECT * FROM users")).toEqual({ valid: true });
    });

    it("accepts SELECT with subquery", () => {
      expect(validateReadonlySql("SELECT * FROM (SELECT id FROM users) AS sub")).toEqual({ valid: true });
    });

    it("accepts CTE", () => {
      expect(validateReadonlySql("WITH cte AS (SELECT 1) SELECT * FROM cte")).toEqual({ valid: true });
    });

    it("accepts SELECT with trailing semicolon", () => {
      expect(validateReadonlySql("SELECT 1;")).toEqual({ valid: true });
    });

    it("does not false-positive on 'updated_at' column", () => {
      expect(validateReadonlySql("SELECT updated_at FROM users")).toEqual({ valid: true });
    });

    it("does not false-positive on 'deleted' column", () => {
      expect(validateReadonlySql("SELECT deleted FROM users WHERE deleted = false")).toEqual({ valid: true });
    });

    it("does not false-positive on 'created_at' column", () => {
      expect(validateReadonlySql("SELECT created_at FROM users")).toEqual({ valid: true });
    });

    it("does not false-positive on 'is_replaced' column", () => {
      expect(validateReadonlySql("SELECT is_replaced FROM items")).toEqual({ valid: true });
    });

    it("does not false-positive on string literals containing keywords", () => {
      expect(validateReadonlySql("SELECT * FROM users WHERE status = 'INSERT'")).toEqual({ valid: true });
    });

    it("does not false-positive on string literal with semicolon", () => {
      expect(validateReadonlySql("SELECT * FROM users WHERE name = 'foo;bar'")).toEqual({ valid: true });
    });

    it("accepts EXPLAIN-like column names", () => {
      expect(validateReadonlySql("SELECT grant_type FROM oauth_tokens")).toEqual({ valid: true });
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
      const result = validateReadonlySql("MERGE INTO users USING source ON users.id = source.id WHEN MATCHED THEN UPDATE SET name = source.name");
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
});
