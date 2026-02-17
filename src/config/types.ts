import { z } from "zod";

const PostgresConfigSchema = z.object({
  id: z.string(),
  type: z.literal("postgresql"),
  host: z.string(),
  port: z.number().default(5432),
  database: z.string(),
  user: z.string(),
  password: z.string().default(""),
  ssl: z.boolean().optional(),
  description: z.string().optional(),
  lazyConnection: z.boolean().optional(),
  maxRows: z.number().optional(),
  queryTimeout: z.number().optional(),
});

const ClickHouseConfigSchema = z.object({
  id: z.string(),
  type: z.literal("clickhouse"),
  url: z.string(),
  database: z.string(),
  user: z.string().default("default"),
  password: z.string().default(""),
  description: z.string().optional(),
  lazyConnection: z.boolean().optional(),
  maxRows: z.number().optional(),
  queryTimeout: z.number().optional(),
});

const DatabaseConfigSchema = z.discriminatedUnion("type", [
  PostgresConfigSchema,
  ClickHouseConfigSchema,
]);

const DefaultsSchema = z.object({
  maxRows: z.number().default(100),
  lazyConnection: z.boolean().default(true),
  toolsPerDatabase: z.boolean().default(false),
  queryTimeout: z.number().default(30000),
});

export const AppConfigSchema = z.object({
  defaults: DefaultsSchema.optional().transform((v) => v ?? {
    maxRows: 100,
    lazyConnection: true,
    toolsPerDatabase: false,
    queryTimeout: 30000,
  }),
  databases: z.array(DatabaseConfigSchema).min(1),
});

export type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
export type ClickHouseConfig = z.infer<typeof ClickHouseConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type Defaults = z.infer<typeof DefaultsSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export type ResolvedDatabaseConfig = DatabaseConfig & {
  lazyConnection: boolean;
  maxRows: number;
  queryTimeout: number;
};

export function resolveDbConfig(db: DatabaseConfig, defaults: Defaults): ResolvedDatabaseConfig {
  return {
    ...db,
    lazyConnection: db.lazyConnection ?? defaults.lazyConnection,
    maxRows: db.maxRows ?? defaults.maxRows,
    queryTimeout: db.queryTimeout ?? defaults.queryTimeout,
  } as ResolvedDatabaseConfig;
}
