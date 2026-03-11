import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Record<string, {
    status: "ok" | "warning" | "error";
    message?: string;
    latency?: number;
  }>;
  uptime: number;
  lastCheck: Date;
}

export interface HeartbeatOptions {
  intervalMs?: number;
  onHealthChange?: (status: HealthStatus) => void;
}

type HealthCheck = () => Promise<{
  status: "ok" | "warning" | "error";
  message?: string;
  latency?: number;
}>;

export class Heartbeat {
  private intervalMs: number;
  private checks: Map<string, HealthCheck> = new Map();
  private intervalId: Timer | null = null;
  private startTime: Date;
  private lastStatus: HealthStatus | null = null;
  private onHealthChange?: (status: HealthStatus) => void;
  private log = logger.child("heartbeat");

  constructor(_config: Config, options: HeartbeatOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30000;
    this.onHealthChange = options.onHealthChange;
    this.startTime = new Date();
  }

  registerCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
    this.log.debug(`Registered health check: ${name}`);
  }

  removeCheck(name: string): boolean {
    return this.checks.delete(name);
  }

  async runChecks(): Promise<HealthStatus> {
    const checks: HealthStatus["checks"] = {};
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

    for (const [name, check] of this.checks) {
      try {
        const start = Date.now();
        const result = await check();
        const latency = Date.now() - start;

        checks[name] = {
          status: result.status,
          message: result.message,
          latency: result.latency ?? latency,
        };

        if (result.status === "warning" && overallStatus === "healthy") {
          overallStatus = "degraded";
        } else if (result.status === "error") {
          overallStatus = "unhealthy";
        }
      } catch (error) {
        checks[name] = {
          status: "error",
          message: (error as Error).message,
        };
        overallStatus = "unhealthy";
      }
    }

    const status: HealthStatus = {
      status: overallStatus,
      checks,
      uptime: Date.now() - this.startTime.getTime(),
      lastCheck: new Date(),
    };

    const prevStatus = this.lastStatus?.status;
    if (prevStatus && prevStatus !== overallStatus) {
      this.log.info(`Health status changed: ${prevStatus} -> ${overallStatus}`);
      this.onHealthChange?.(status);
    }

    this.lastStatus = status;
    return status;
  }

  start(): void {
    if (this.intervalId) {
      this.log.warn("Heartbeat already running");
      return;
    }

    this.runChecks();

    this.intervalId = setInterval(async () => {
      await this.runChecks();
    }, this.intervalMs);

    this.log.info(`Heartbeat started (interval: ${this.intervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.log.info("Heartbeat stopped");
    }
  }

  getStatus(): HealthStatus | null {
    return this.lastStatus;
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

export function createHeartbeat(config: Config, options?: HeartbeatOptions): Heartbeat {
  const heartbeat = new Heartbeat(config, options);

  heartbeat.registerCheck("memory", async () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const ratio = memUsage.heapUsed / memUsage.heapTotal;

    if (ratio > 0.9) {
      return {
        status: "error",
        message: `Memory critically high: ${heapUsedMB}/${heapTotalMB}MB`,
      };
    } else if (ratio > 0.75) {
      return {
        status: "warning",
        message: `Memory usage high: ${heapUsedMB}/${heapTotalMB}MB`,
      };
    }

    return {
      status: "ok",
      message: `${heapUsedMB}/${heapTotalMB}MB used`,
    };
  });

  return heartbeat;
}
