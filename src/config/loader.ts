import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppConfigSchema, type AppConfig } from "./types.js";

export function loadConfig(configPath: string): AppConfig {
  const absolutePath = resolve(configPath);
  const raw = readFileSync(absolutePath, "utf-8");
  const json = JSON.parse(raw);
  return AppConfigSchema.parse(json);
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
