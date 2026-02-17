import { z } from "zod";
import type { ConnectorManager } from "../../connectors/manager.js";
import { formatSuccess, formatError } from "../../utils/response.js";

interface SlowQuery {
  sql: string;
  duration: number;
  timestamp: Date;
  database: string;
}

export class PerformanceTracker {
  private slowQueries: SlowQuery[] = [];
  private threshold = 1000; // ms

  recordQuery(sql: string, duration: number, database: string) {
    if (duration >= this.threshold) {
      this.slowQueries.push({ sql, duration, timestamp: new Date(), database });
      if (this.slowQueries.length > 100) this.slowQueries.shift();
    }
  }

  getSlowQueries(database?: string, limit = 20): SlowQuery[] {
    const filtered = database
      ? this.slowQueries.filter((q) => q.database === database)
      : this.slowQueries;
    return filtered.slice(-limit);
  }

  setThreshold(ms: number) {
    this.threshold = ms;
  }

  getThreshold(): number {
    return this.threshold;
  }

  reset() {
    this.slowQueries = [];
  }
}

export function createPerformanceParams(dbIds: string[]) {
  return {
    database: z.enum(dbIds as [string, ...string[]]).describe(`Database ID. Available: ${dbIds.join(", ")}`),
    action: z.enum(["getSlowQueries", "getMetrics", "reset", "setThreshold"]).describe("Performance action"),
    threshold: z.number().optional().describe("Slow query threshold in ms (for setThreshold)"),
    limit: z.number().optional().describe("Max results (for getSlowQueries)"),
  };
}

export function performanceHandler(manager: ConnectorManager) {
  const tracker = manager.getPerformanceTracker();
  return async (params: {
    database: string;
    action: string;
    threshold?: number;
    limit?: number;
  }) => {
    try {
      switch (params.action) {
        case "getSlowQueries":
          return formatSuccess({
            data: tracker.getSlowQueries(params.database, params.limit),
            database: params.database,
          });
        case "getMetrics":
          return formatSuccess({
            data: {
              slowQueryThreshold: tracker.getThreshold(),
              connectedDatabases: manager.getDatabaseIds(),
            },
            database: params.database,
          });
        case "reset":
          tracker.reset();
          return formatSuccess({ data: "Performance metrics reset" });
        case "setThreshold":
          if (!params.threshold) return formatError("threshold is required for setThreshold");
          tracker.setThreshold(params.threshold);
          return formatSuccess({ data: `Threshold set to ${params.threshold}ms` });
        default:
          return formatError(`Unknown action: ${params.action}`);
      }
    } catch (err) {
      return formatError(String(err));
    }
  };
}
