import { describe, it, expect } from "vitest";
import { AppConfigSchema, resolveDbConfig, type DatabaseConfig, type Defaults } from "../../src/config/types.js";

describe("AppConfigSchema", () => {
  const minimalConfig = {
    databases: [{ id: "test", type: "postgresql", host: "localhost", database: "testdb", user: "user" }],
  };

  it("parses minimal config with defaults", () => {
    const result = AppConfigSchema.parse(minimalConfig);
    expect(result.transport.type).toBe("stdio");
    expect(result.defaults.maxRows).toBe(100);
    expect(result.defaults.lazyConnection).toBe(true);
    expect(result.defaults.toolsPerDatabase).toBe(false);
    expect(result.defaults.queryTimeout).toBe(30000);
    expect(result.defaults.logLevel).toBe("info");
  });

  it("parses full postgresql config", () => {
    const result = AppConfigSchema.parse({
      ...minimalConfig,
      defaults: { maxRows: 200, logLevel: "debug" },
    });
    expect(result.defaults.maxRows).toBe(200);
    expect(result.defaults.logLevel).toBe("debug");
  });

  it("parses http transport", () => {
    const result = AppConfigSchema.parse({
      ...minimalConfig,
      transport: { type: "http", port: 8080 },
    });
    expect(result.transport.type).toBe("http");
    if (result.transport.type === "http") {
      expect(result.transport.port).toBe(8080);
      expect(result.transport.sessionTimeout).toBe(30 * 60 * 1000);
    }
  });

  it("rejects empty databases array", () => {
    expect(() => AppConfigSchema.parse({ databases: [] })).toThrow();
  });

  it("rejects unknown database type", () => {
    expect(() =>
      AppConfigSchema.parse({
        databases: [{ id: "x", type: "mysql", host: "h", database: "d", user: "u" }],
      }),
    ).toThrow();
  });

  it("parses clickhouse config", () => {
    const result = AppConfigSchema.parse({
      databases: [{ id: "ch", type: "clickhouse", url: "http://localhost:8123", database: "default" }],
    });
    expect(result.databases[0].type).toBe("clickhouse");
  });

  it("parses postgresql config with sslCa", () => {
    const result = AppConfigSchema.parse({
      databases: [
        {
          id: "pg",
          type: "postgresql",
          host: "localhost",
          database: "testdb",
          user: "user",
          ssl: true,
          sslCa: "/path/to/ca.pem",
        },
      ],
    });
    const db = result.databases[0];
    expect(db.type).toBe("postgresql");
    if (db.type === "postgresql") {
      expect(db.sslCa).toBe("/path/to/ca.pem");
    }
  });

  it("parses clickhouse config with tls", () => {
    const result = AppConfigSchema.parse({
      databases: [
        {
          id: "ch",
          type: "clickhouse",
          url: "https://localhost:8443",
          database: "default",
          tls: { ca: "/path/to/ca.pem", rejectUnauthorized: false },
        },
      ],
    });
    const db = result.databases[0];
    expect(db.type).toBe("clickhouse");
    if (db.type === "clickhouse") {
      expect(db.tls?.ca).toBe("/path/to/ca.pem");
      expect(db.tls?.rejectUnauthorized).toBe(false);
    }
  });

  it("parses postgresql with connectionString", () => {
    const result = AppConfigSchema.parse({
      databases: [
        {
          id: "pg",
          type: "postgresql",
          connectionString: "postgresql://user:pass@localhost:5432/mydb",
        },
      ],
    });
    const db = result.databases[0];
    expect(db.type).toBe("postgresql");
    if (db.type === "postgresql") {
      expect(db.connectionString).toBe("postgresql://user:pass@localhost:5432/mydb");
    }
  });

  it("rejects postgresql without connectionString and without host+database+user", () => {
    expect(() =>
      AppConfigSchema.parse({
        databases: [{ id: "pg", type: "postgresql" }],
      }),
    ).toThrow();
  });

  it("rejects postgresql with only host (missing database and user)", () => {
    expect(() =>
      AppConfigSchema.parse({
        databases: [{ id: "pg", type: "postgresql", host: "localhost" }],
      }),
    ).toThrow();
  });
});

describe("resolveDbConfig", () => {
  const defaults: Defaults = {
    maxRows: 100,
    lazyConnection: true,
    toolsPerDatabase: false,
    queryTimeout: 30000,
    logLevel: "info",
  };

  it("applies defaults when db config has no overrides", () => {
    const db: DatabaseConfig = {
      id: "test",
      type: "postgresql",
      host: "localhost",
      port: 5432,
      database: "testdb",
      user: "user",
      password: "",
      sslRejectUnauthorized: true,
    };
    const resolved = resolveDbConfig(db, defaults);
    expect(resolved.maxRows).toBe(100);
    expect(resolved.lazyConnection).toBe(true);
    expect(resolved.queryTimeout).toBe(30000);
  });

  it("uses db-level overrides when present", () => {
    const db: DatabaseConfig = {
      id: "test",
      type: "postgresql",
      host: "localhost",
      port: 5432,
      database: "testdb",
      user: "user",
      password: "",
      sslRejectUnauthorized: true,
      maxRows: 500,
      lazyConnection: false,
      queryTimeout: 60000,
    };
    const resolved = resolveDbConfig(db, defaults);
    expect(resolved.maxRows).toBe(500);
    expect(resolved.lazyConnection).toBe(false);
    expect(resolved.queryTimeout).toBe(60000);
  });
});
