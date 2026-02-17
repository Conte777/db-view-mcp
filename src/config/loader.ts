import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppConfigSchema, type AppConfig } from "./types.js";

export function loadConfig(configPath: string): AppConfig {
  const absolutePath = resolve(configPath);
  const raw = readFileSync(absolutePath, "utf-8");
  const json = JSON.parse(raw);
  return AppConfigSchema.parse(json);
}

export function parseCliArgs(args: string[]): { configPath: string } {
  const configIndex = args.indexOf("--config");
  if (configIndex === -1 || configIndex + 1 >= args.length) {
    throw new Error("Usage: db-view-mcp --config <path-to-config.json>");
  }
  return { configPath: args[configIndex + 1] };
}
