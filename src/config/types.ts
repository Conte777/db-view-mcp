import { z } from "zod";

const PostgresConfigBaseSchema = z.object({
  id: z.string(),
  type: z.literal("postgresql"),
  connectionString: z.string().optional(),
  host: z.string().optional(),
  port: z.number().default(5432),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().default(""),
  ssl: z.boolean().optional(),
  sslRejectUnauthorized: z.boolean().default(true),
  sslCa: z.string().optional(),
  description: z.string().optional(),
  lazyConnection: z.boolean().optional(),
  maxRows: z.number().optional(),
  queryTimeout: z.number().optional(),
});

const PostgresConfigSchema = PostgresConfigBaseSchema.superRefine((data, ctx) => {
  if (!data.connectionString && (!data.host || !data.database || !data.user)) {
    ctx.addIssue({
      code: "custom",
      message: "Either 'connectionString' or 'host' + 'database' + 'user' must be provided",
    });
  }
});

const ClickHouseConfigSchema = z.object({
  id: z.string(),
  type: z.literal("clickhouse"),
  url: z.string(),
  database: z.string(),
  user: z.string().default("default"),
  password: z.string().default(""),
  tls: z
    .object({
      ca: z.string().optional(),
      rejectUnauthorized: z.boolean().default(true),
    })
    .optional(),
  description: z.string().optional(),
  lazyConnection: z.boolean().optional(),
  maxRows: z.number().optional(),
  queryTimeout: z.number().optional(),
});

const DatabaseConfigSchema = z.union([PostgresConfigSchema, ClickHouseConfigSchema]);

const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const DefaultsSchema = z.object({
  maxRows: z.number().default(100),
  lazyConnection: z.boolean().default(true),
  toolsPerDatabase: z.boolean().default(false),
  queryTimeout: z.number().default(30000),
  logLevel: LogLevelSchema.default("info"),
});

const HttpTransportConfigSchema = z.object({
  type: z.literal("http"),
  port: z.number().default(3000),
  host: z.string().default("127.0.0.1"),
  stateless: z.boolean().default(false),
  sessionTimeout: z.number().default(30 * 60 * 1000), // 30 minutes
  auth: z
    .object({
      type: z.literal("bearer"),
      token: z.string(),
    })
    .optional(),
});

const StdioTransportConfigSchema = z.object({
  type: z.literal("stdio"),
});

const TransportConfigSchema = z.discriminatedUnion("type", [StdioTransportConfigSchema, HttpTransportConfigSchema]);

export const AppConfigSchema = z.object({
  transport: TransportConfigSchema.optional().default({ type: "stdio" }),
  defaults: DefaultsSchema.optional().transform(
    (v) =>
      v ?? {
        maxRows: 100,
        lazyConnection: true,
        toolsPerDatabase: false,
        queryTimeout: 30000,
        logLevel: "info" as const,
      },
  ),
  databases: z.array(DatabaseConfigSchema).min(1),
});

export type PostgresConfig = z.infer<typeof PostgresConfigBaseSchema>;
export type ClickHouseConfig = z.infer<typeof ClickHouseConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type Defaults = z.infer<typeof DefaultsSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type HttpTransportConfig = z.infer<typeof HttpTransportConfigSchema>;
export type TransportConfig = z.infer<typeof TransportConfigSchema>;

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
