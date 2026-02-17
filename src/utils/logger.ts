type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export class Logger {
  private level: number;
  private context: Record<string, unknown>;

  constructor(level: LogLevel = "info", context: Record<string, unknown> = {}) {
    this.level = LOG_LEVELS[level];
    this.context = context;
  }

  child(context: Record<string, unknown>): Logger {
    const child = new Logger("debug", { ...this.context, ...context });
    child.level = this.level;
    return child;
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log("error", message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LOG_LEVELS[level] < this.level) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...data,
    };

    process.stderr.write(JSON.stringify(entry) + "\n");
  }
}

let globalLogger = new Logger("info");

export function initLogger(level: LogLevel): Logger {
  globalLogger = new Logger(level);
  return globalLogger;
}

export function getLogger(): Logger {
  return globalLogger;
}
