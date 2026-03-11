import { mkdirSync, unlinkSync, renameSync, existsSync } from "node:fs";
import * as path from "node:path";
import { getHiveDir, loadConfig } from "../config/loader.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export type LogEntryListener = (entry: LogEntry) => void;

const _logListeners: Set<LogEntryListener> = new Set();

/** Subscribe to real-time log entries */
export function onLogEntry(cb: LogEntryListener): void {
  _logListeners.add(cb);
}

/** Unsubscribe from real-time log entries */
export function removeLogListener(cb: LogEntryListener): void {
  _logListeners.delete(cb);
}

function emitLogEntry(entry: LogEntry): void {
  for (const cb of _logListeners) {
    try { cb(entry); } catch { /* listener error should not crash logger */ }
  }
}

export interface LoggerConfig {
  level: LogLevel;
  dir: string;
  maxSizeMB: number;
  maxFiles: number;
  redactSensitive: boolean;
  console: boolean;
}

export interface LogMeta extends Record<string, unknown> {
  correlationId?: string;
  sessionId?: string;
  userId?: string;
  agentId?: string;
  channel?: string;
  toolName?: string;
  duration?: number;
  error?: string;
  stack?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /auth/i,
];

const COLORS = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
};

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(process.env.HOME || "", p.slice(1));
  }
  return p;
}

function redact(obj: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (seen.has(obj as object)) {
    return "[Circular]";
  }

  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_PATTERNS.some((p) => p.test(key));
    if (isSensitive) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redact(value, seen);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, meta?: unknown, correlationId?: string): string {
  const timestamp = formatTimestamp();
  const corrStr = correlationId ? ` [${correlationId.slice(0, 8)}]` : "";
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}]${corrStr} [${level.toUpperCase()}] ${message}${metaStr}`;
}

export class Logger {
  private config: LoggerConfig;
  private logFile: string | null = null;
  private currentSize = 0;
  private correlationContext: LogMeta = {};

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? "info",
      dir: config.dir ?? path.join(getHiveDir(), "logs"),
      maxSizeMB: config.maxSizeMB ?? 10,
      maxFiles: config.maxFiles ?? 5,
      redactSensitive: config.redactSensitive ?? true,
      console: config.console ?? true,
    };
  }

  setCorrelationContext(context: Partial<LogMeta>): void {
    this.correlationContext = { ...this.correlationContext, ...context };
  }

  clearCorrelationContext(): void {
    this.correlationContext = {};
  }

  getCorrelationId(): string | undefined {
    return this.correlationContext.correlationId;
  }

  withCorrelationId(id: string): this {
    this.correlationContext.correlationId = id;
    return this;
  }

  private initLogFile(): void {
    const logDir = expandPath(this.config.dir);

    try {
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      this.logFile = path.join(logDir, `hive-${new Date().toISOString().split("T")[0]}.log`);

      const file = Bun.file(this.logFile);
      this.currentSize = file.size ?? 0;
    } catch {
      this.logFile = null;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private writeToConsole(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.config.console) return;

    const color = COLORS[level];
    const mergedMeta = this.mergeMeta(meta);
    const displayMeta = this.config.redactSensitive && mergedMeta ? redact(mergedMeta) : mergedMeta;
    const metaStr = displayMeta && Object.keys(displayMeta as object).length > 0
      ? ` ${JSON.stringify(displayMeta)}`
      : "";

    const prefix = `${COLORS.dim}${formatTimestamp()}${COLORS.reset}`;
    const corrStr = this.correlationContext.correlationId
      ? ` ${COLORS.dim}[${this.correlationContext.correlationId.slice(0, 8)}]${COLORS.reset}`
      : "";
    const levelStr = `${color}${COLORS.bright}[${level.toUpperCase().padEnd(5)}]${COLORS.reset}`;

    console.log(`${prefix}${corrStr} ${levelStr} ${message}${metaStr}`);
  }

  private mergeMeta(meta?: unknown): LogMeta | undefined {
    if (!meta && Object.keys(this.correlationContext).length === 0) return undefined;

    const contextWithoutCorrId = { ...this.correlationContext };
    delete contextWithoutCorrId.correlationId;

    if (!meta) return contextWithoutCorrId;
    if (typeof meta !== "object") return meta as LogMeta;

    return { ...contextWithoutCorrId, ...(meta as LogMeta) };
  }

  private writeToFile(message: string): void {
    if (!this.logFile) {
      this.initLogFile();
    }
    if (!this.logFile) return;

    try {
      const line = message + "\n";
      const bytes = Buffer.byteLength(line);

      if (this.currentSize + bytes > this.config.maxSizeMB * 1024 * 1024) {
        this.rotateLogs();
      }

      // Use sync append for logging reliability
      const encoder = new TextEncoder();
      const data = encoder.encode(line);
      Bun.write(this.logFile, data).catch(() => { });
      this.currentSize += bytes;
    } catch {
      // Silently fail if we can't write to log file
    }
  }

  private rotateLogs(): void {
    if (!this.logFile) return;

    const logDir = path.dirname(this.logFile);
    const baseName = path.basename(this.logFile, ".log");

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(logDir, `${baseName}.${i}.log`);
      const newFile = path.join(logDir, `${baseName}.${i + 1}.log`);

      try {
        if (existsSync(oldFile)) {
          if (i === this.config.maxFiles - 1) {
            unlinkSync(oldFile);
          } else {
            renameSync(oldFile, newFile);
          }
        }
      } catch {
        // Continue rotation even if one file fails
      }
    }

    try {
      renameSync(this.logFile, path.join(logDir, `${baseName}.1.log`));
      this.currentSize = 0;
    } catch {
      // Continue even if rotation fails
    }
  }

  debug(message: string, meta?: unknown): void {
    if (!this.shouldLog("debug")) return;
    const mergedMeta = this.mergeMeta(meta);
    const formatted = formatMessage("debug", message, mergedMeta, this.correlationContext.correlationId);
    this.writeToConsole("debug", message, meta);
    this.writeToFile(formatted);
    emitLogEntry({ timestamp: formatTimestamp(), level: "debug", source: "core", message, meta: mergedMeta as Record<string, unknown> | undefined });
  }

  info(message: string, meta?: unknown): void {
    if (!this.shouldLog("info")) return;
    const mergedMeta = this.mergeMeta(meta);
    const formatted = formatMessage("info", message, mergedMeta, this.correlationContext.correlationId);
    this.writeToConsole("info", message, meta);
    this.writeToFile(formatted);
    emitLogEntry({ timestamp: formatTimestamp(), level: "info", source: "core", message, meta: mergedMeta as Record<string, unknown> | undefined });
  }

  warn(message: string, meta?: unknown): void {
    if (!this.shouldLog("warn")) return;
    const mergedMeta = this.mergeMeta(meta);
    const formatted = formatMessage("warn", message, mergedMeta, this.correlationContext.correlationId);
    this.writeToConsole("warn", message, meta);
    this.writeToFile(formatted);
    emitLogEntry({ timestamp: formatTimestamp(), level: "warn", source: "core", message, meta: mergedMeta as Record<string, unknown> | undefined });
  }

  error(message: string, meta?: unknown): void {
    if (!this.shouldLog("error")) return;
    const mergedMeta = this.mergeMeta(meta);
    const formatted = formatMessage("error", message, mergedMeta, this.correlationContext.correlationId);
    this.writeToConsole("error", message, meta);
    this.writeToFile(formatted);
    emitLogEntry({ timestamp: formatTimestamp(), level: "error", source: "core", message, meta: mergedMeta as Record<string, unknown> | undefined });
  }

  child(context: string): ChildLogger {
    return new ChildLogger(this, context, this.correlationContext);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

export class ChildLogger {
  constructor(
    private parent: Logger,
    private context: string,
    private correlationContext: LogMeta = {}
  ) { }

  private prefix(message: string): string {
    return `[${this.context}] ${message}`;
  }

  withCorrelationId(id: string): this {
    this.correlationContext.correlationId = id;
    return this;
  }

  setContext(context: Partial<LogMeta>): void {
    this.correlationContext = { ...this.correlationContext, ...context };
  }

  debug(message: string, meta?: unknown): void {
    this.parent.debug(this.prefix(message), this.mergeMeta(meta));
  }

  info(message: string, meta?: unknown): void {
    this.parent.info(this.prefix(message), this.mergeMeta(meta));
  }

  warn(message: string, meta?: unknown): void {
    this.parent.warn(this.prefix(message), this.mergeMeta(meta));
  }

  error(message: string, meta?: unknown): void {
    this.parent.error(this.prefix(message), this.mergeMeta(meta));
  }

  child(subContext: string): ChildLogger {
    return new ChildLogger(
      this.parent,
      `${this.context}:${subContext}`,
      this.correlationContext
    );
  }

  private mergeMeta(meta?: unknown): LogMeta | undefined {
    if (!meta && Object.keys(this.correlationContext).length === 0) return undefined;
    if (!meta) return { ...this.correlationContext };
    if (typeof meta !== "object") return meta as LogMeta;
    return { ...this.correlationContext, ...(meta as LogMeta) };
  }
}

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (!_logger) {
    const config = loadConfig();
    _logger = new Logger({ level: config.logging?.level });
  }
  return _logger;
}

export const logger = {
  child: (opts: any) => getLogger().child(opts),
  debug: (msg: string, meta?: unknown) => getLogger().debug(msg, meta),
  info: (msg: string, meta?: unknown) => getLogger().info(msg, meta),
  warn: (msg: string, meta?: unknown) => getLogger().warn(msg, meta),
  error: (msg: string, meta?: unknown) => getLogger().error(msg, meta),
  setCorrelationContext: (ctx: any) => getLogger().setCorrelationContext(ctx),
  clearCorrelationContext: () => getLogger().clearCorrelationContext(),
  getCorrelationId: () => getLogger().getCorrelationId(),
  withCorrelationId: (id: string) => getLogger().withCorrelationId(id),
  setLevel: (level: any) => getLogger().setLevel(level),
  setHandler: (handler: any) => { /* no-op for compatibility */ },
};
