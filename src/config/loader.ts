import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppConfigSchema, type AppConfig } from "./types.js";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

export function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(ENV_VAR_PATTERN, (match, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable "${varName}" is not defined (referenced as "${match}")`);
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVariables(item));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVariables(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath: string): AppConfig {
  const absolutePath = resolve(configPath);
  const raw = readFileSync(absolutePath, "utf-8");
  const json = JSON.parse(raw);
  const resolved = resolveEnvVariables(json);
  return AppConfigSchema.parse(resolved);
}

export function parseCliArgs(args: string[]): { configPath: string; transport?: "stdio" | "http" } {
  const configIndex = args.indexOf("--config");
  if (configIndex === -1 || configIndex + 1 >= args.length) {
    throw new Error("Usage: db-view-mcp --config <path-to-config.json> [--transport stdio|http]");
  }

  const result: { configPath: string; transport?: "stdio" | "http" } = {
    configPath: args[configIndex + 1],
  };

  const transportIndex = args.indexOf("--transport");
  if (transportIndex !== -1 && transportIndex + 1 < args.length) {
    const value = args[transportIndex + 1];
    if (value !== "stdio" && value !== "http") {
      throw new Error(`Invalid transport: "${value}". Must be "stdio" or "http".`);
    }
    result.transport = value;
  }

  return result;
}
