/**
 * Centralized logging service for the application.
 * In production, logs are written to stdout for container log aggregation.
 * In development, provides formatted console output.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    meta,
  };
}

function formatLog(entry: LogEntry): string {
  const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : "";
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${metaStr}`;
}

function writeLog(entry: LogEntry): void {
  const formatted = formatLog(entry);

  if (process.env.NODE_ENV === "production") {
    // In production, write to stdout as JSON for log aggregation
    console.log(JSON.stringify(entry));
  } else {
    // In development, use formatted output with colors
    switch (entry.level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "debug":
      case "info":
      default:
        console.log(formatted);
        break;
    }
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    writeLog(createLogEntry("info", message, meta));
  },

  warn: (message: string, meta?: Record<string, unknown>) => {
    writeLog(createLogEntry("warn", message, meta));
  },

  error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error
      ? { error: error.message, stack: error.stack, ...meta }
      : { error: String(error), ...meta };
    writeLog(createLogEntry("error", message, errorMeta));
  },

  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") {
      writeLog(createLogEntry("debug", message, meta));
    }
  },
};
