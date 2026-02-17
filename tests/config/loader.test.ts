import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEnvVariables } from "../../src/config/loader.js";

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
