export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogHandler = (level: LogLevel, context: string, message: string, data?: Record<string, unknown>) => void;

class Logger {
  private context: string;
  private level: LogLevel = "info";
  private handler: LogHandler | null = null;
  private _parent: Logger | null = null;

  constructor(context: string, handler: LogHandler | null = null) {
    this.context = context;
    this.handler = handler;
  }

  setHandler(handler: LogHandler | null): void {
    this.handler = handler;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // Use own handler if set, otherwise delegate to parent dynamically
    const effectiveHandler = this.handler ?? this._parent?.handler ?? null;
    if (effectiveHandler) {
      effectiveHandler(level, this.context, message, data);
      return;
    }

    // Silent by default if no handler is set, to avoid standard console pollution.
    // The consumer (e.g., Hive Agent) should set a handler to bridge these logs.
  }

  debug(message: string, data?: Record<string, unknown>): void { this.log("debug", message, data); }
  info(message: string, data?: Record<string, unknown>): void { this.log("info", message, data); }
  warn(message: string, data?: Record<string, unknown>): void { this.log("warn", message, data); }
  error(message: string, data?: Record<string, unknown>): void { this.log("error", message, data); }

  child(context: string): Logger {
    const child = new Logger(`${this.context}:${context}`, this.handler);
    child._parent = this;
    return child;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger("mcp");
