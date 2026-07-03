import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, parseCliArgs, resolveEnvVariables } from "../../src/config/loader.js";

describe("resolveEnvVariables", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_HOST = "localhost";
    process.env.TEST_PORT = "5432";
    process.env.TEST_PASSWORD = "secret123";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("replaces ${VAR} in strings", () => {
    expect(resolveEnvVariables("${TEST_HOST}")).toBe("localhost");
  });

  it("replaces multiple vars in one string", () => {
    expect(resolveEnvVariables("${TEST_HOST}:${TEST_PORT}")).toBe("localhost:5432");
  });

  it("replaces nested objects", () => {
    const input = { host: "${TEST_HOST}", port: "${TEST_PORT}" };
    expect(resolveEnvVariables(input)).toEqual({ host: "localhost", port: "5432" });
  });

  it("replaces values in arrays", () => {
    const input = ["${TEST_HOST}", "${TEST_PORT}"];
    expect(resolveEnvVariables(input)).toEqual(["localhost", "5432"]);
  });

  it("passes through numbers", () => {
    expect(resolveEnvVariables(42)).toBe(42);
  });

  it("passes through booleans", () => {
    expect(resolveEnvVariables(true)).toBe(true);
  });

  it("passes through null", () => {
    expect(resolveEnvVariables(null)).toBe(null);
  });

  it("handles deeply nested structures", () => {
    const input = { a: { b: { c: "${TEST_PASSWORD}" } } };
    expect(resolveEnvVariables(input)).toEqual({ a: { b: { c: "secret123" } } });
  });

  it("throws on undefined env variable", () => {
    expect(() => resolveEnvVariables("${UNDEFINED_VAR}")).toThrow(
      'Environment variable "UNDEFINED_VAR" is not defined',
    );
  });

  it("throws with the original reference format", () => {
    expect(() => resolveEnvVariables("${NOPE}")).toThrow("${NOPE}");
  });
});

describe("parseCliArgs", () => {
  it("throws when --config is absent", () => {
    expect(() => parseCliArgs([])).toThrow("Usage:");
  });

  it("throws when --config has no value", () => {
    expect(() => parseCliArgs(["--config"])).toThrow("Usage:");
  });

  it("returns the config path", () => {
    expect(parseCliArgs(["--config", "/x/config.json"])).toEqual({ configPath: "/x/config.json" });
  });

  it("accepts a valid transport", () => {
    expect(parseCliArgs(["--config", "c.json", "--transport", "http"]).transport).toBe("http");
  });

  it("throws on an invalid transport", () => {
    expect(() => parseCliArgs(["--config", "c.json", "--transport", "ftp"])).toThrow("Invalid transport");
  });

  it("ignores a trailing --transport with no value", () => {
    expect(parseCliArgs(["--config", "c.json", "--transport"]).transport).toBeUndefined();
  });
});

describe("loadConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db-view-cfg-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(content: string): string {
    const path = join(dir, "config.json");
    writeFileSync(path, content);
    return path;
  }

  it("reads, interpolates env and validates a config file", () => {
    process.env.CFG_HOST = "db.local";
    const path = writeConfig(
      JSON.stringify({
        databases: [{ id: "pg", type: "postgresql", host: "${CFG_HOST}", database: "d", user: "u" }],
      }),
    );
    const cfg = loadConfig(path);
    expect((cfg.databases[0] as { host?: string }).host).toBe("db.local");
    expect(cfg.transport.type).toBe("stdio"); // default
    expect(cfg.defaults.maxRows).toBe(100); // default
    delete process.env.CFG_HOST;
  });

  it("throws on malformed JSON", () => {
    expect(() => loadConfig(writeConfig("{ not json "))).toThrow();
  });

  it("throws on an undefined env variable", () => {
    const path = writeConfig(
      JSON.stringify({
        databases: [{ id: "pg", type: "postgresql", host: "${MISSING_ENV_XYZ}", database: "d", user: "u" }],
      }),
    );
    expect(() => loadConfig(path)).toThrow('Environment variable "MISSING_ENV_XYZ"');
  });

  it("throws on a schema-invalid config (empty databases)", () => {
    expect(() => loadConfig(writeConfig(JSON.stringify({ databases: [] })))).toThrow();
  });
});
