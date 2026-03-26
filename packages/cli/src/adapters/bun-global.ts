/**
 * Bun Global Adapter
 * 
 * Handles Hive installation via `bun install -g @johpaz/hive-agents`.
 * Uses global npm-style installation with local filesystem paths.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type {
  InstallationAdapter,
  InstallationConfig,
  GatewayConfig,
  ValidationResult,
} from "./types";
import {
  getHiveDir,
  getDefaultPaths,
  loadEnvFile,
  mergeEnv,
  expandPath,
  waitForHttpPort,
  isPortAvailable,
} from "./config";
import { PORTS } from "./types";

/**
 * Bun Global installation adapter
 */
export class BunGlobalAdapter implements InstallationAdapter {
  readonly type = "bun-global" as const;
  readonly name = "Bun Global (npm-style)";

  private hiveDir: string;
  private pidFile: string;

  constructor(options?: { hiveDir?: string }) {
    this.hiveDir = options?.hiveDir || getHiveDir();
    this.pidFile = path.join(this.hiveDir, "gateway.pid");
  }

  /**
   * Check if Bun global installation is available
   */
  async detect(): Promise<boolean> {
    try {
      // Check if Bun is installed
      execSync("bun --version", { stdio: "ignore" });

      // Check if hive is installed globally
      try {
        const output = execSync("bun which hive", {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });

        const hivePath = output.trim();
        if (hivePath && existsSync(hivePath)) {
          return true;
        }
      } catch {
        // Try alternative detection
        const output = execSync("bun pm ls -g", {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });

        if (output.includes("@johpaz/hive-agents") || output.includes("hive")) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get Bun Global installation configuration
   */
  async getConfig(): Promise<InstallationConfig> {
    const env = await this.getEnvironment();
    const paths = getDefaultPaths(this.hiveDir);

    // For global installation, try to find UI directory
    let uiDir: string | null = null;

    // Check in dist directory relative to hive binary
    try {
      const hivePath = execSync("bun which hive", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const distDir = path.dirname(hivePath);
      const potentialUiDir = path.join(distDir, "ui");

      if (existsSync(potentialUiDir)) {
        uiDir = potentialUiDir;
      }
    } catch {
      // Binary location not found, will use embedded UI fallback
    }

    // Also check current working directory for development
    if (!uiDir) {
      const cwdUiDir = path.join(process.cwd(), "packages/hive-ui/dist");
      if (existsSync(cwdUiDir)) {
        uiDir = cwdUiDir;
      }
    }

    paths.uiDir = uiDir;

    const port = parseInt(env.HIVE_PORT || "18790", 10) || PORTS.GATEWAY;
    const publicUrl = env.HIVE_PUBLIC_URL || undefined;

    return {
      type: this.type,
      gateway: {
        host: env.HIVE_HOST || "127.0.0.1",
        port,
        wsPort: port,
        codeBridgePort: PORTS.CODE_BRIDGE,
        publicUrl,
        openBrowser: !env.NO_BROWSER,
        daemon: !!env.HIVE_DAEMON,
      },
      paths,
      env,
      isDev: process.env.HIVE_DEV === "true" || process.env.HIVE_DEV === "1",
      hasEmbeddedUI: false,
    };
  }

  /**
   * Start Hive gateway using Bun
   */
  async start(config: GatewayConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ["hive", "start", "--skip-check"];

      if (config.daemon) {
        args.push("--daemon");
      }

      const child = spawn("bun", args, {
        stdio: "inherit",
        detached: false,
        env: mergeEnv(process.env, {
          HIVE_HOME: this.hiveDir,
        }),
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Bun hive exited with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop Hive gateway
   */
  async stop(): Promise<void> {
    try {
      if (existsSync(this.pidFile)) {
        const pid = parseInt(readFileSync(this.pidFile, "utf-8").trim(), 10);

        if (!isNaN(pid)) {
          try {
            process.kill(pid, "SIGTERM");
            console.log(`✅ Hive Gateway detenido (PID: ${pid})`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") {
              console.log("⚠️  Hive Gateway no está corriendo");
            } else {
              throw error;
            }
          } finally {
            try {
              unlinkSync(this.pidFile);
            } catch {
              // Ignore errors removing PID file
            }
          }
        }
      } else {
        // Try to kill by process name
        try {
          execSync("pkill -f 'bun.*hive.*start'", { stdio: "ignore" });
          console.log("✅ Hive Gateway detenido");
        } catch {
          console.log("⚠️  Hive Gateway no está corriendo");
        }
      }
    } catch (error) {
      console.error("❌ Error deteniendo Hive Gateway:", (error as Error).message);
      throw error;
    }
  }

  /**
   * Check if gateway is running
   */
  async isRunning(): Promise<boolean> {
    try {
      if (existsSync(this.pidFile)) {
        const pid = parseInt(readFileSync(this.pidFile, "utf-8").trim(), 10);

        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            // Process not running, clean up stale PID file
            try {
              unlinkSync(this.pidFile);
            } catch {
              // Ignore
            }
          }
        }
      }

      // Alternative: check if port is in use
      const config = await this.getConfig();
      const portAvailable = await isPortAvailable(config.gateway.port);
      return !portAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Get gateway process ID
   */
  async getPid(): Promise<number | null> {
    try {
      if (existsSync(this.pidFile)) {
        const pid = parseInt(readFileSync(this.pidFile, "utf-8").trim(), 10);
        if (!isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            return pid;
          } catch {
            // Process not running
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get Bun Global environment variables
   */
  async getEnvironment(): Promise<Record<string, string>> {
    const fileEnv = loadEnvFile();
    const homeEnv = loadEnvFile(path.join(this.hiveDir, ".env"));

    const defaults = {
      HIVE_HOST: "127.0.0.1",
      HIVE_PORT: String(PORTS.GATEWAY),
      HIVE_HOME: this.hiveDir,
      NO_BROWSER: "0",
      HIVE_PUBLIC_URL: "",
      HIVE_DAEMON: "0",
    };

    return mergeEnv(defaults, fileEnv, homeEnv, process.env);
  }

  /**
   * Validate Bun Global installation
   */
  async validate(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    // Check Bun installation
    try {
      const version = execSync("bun --version", { encoding: "utf-8" }).trim();
      info.push(`Bun: v${version}`);
    } catch {
      errors.push("Bun is not installed or not in PATH");
    }

    // Check global hive installation
    try {
      const hivePath = execSync("bun which hive", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (hivePath && existsSync(hivePath)) {
        info.push(`Hive binary: ${hivePath}`);

        // Check if UI directory exists
        const distDir = path.dirname(hivePath);
        const uiDir = path.join(distDir, "ui");

        if (existsSync(uiDir)) {
          info.push(`UI directory: ${uiDir}`);
        } else {
          warnings.push("UI directory not found - may use embedded UI");
        }
      } else {
        errors.push("Hive is not installed globally");
      }
    } catch {
      errors.push("Hive is not installed globally (try: bun install -g @johpaz/hive-agents)");
    }

    // Check Hive directory
    if (existsSync(this.hiveDir)) {
      info.push(`Hive home: ${this.hiveDir}`);
    } else {
      warnings.push(`Hive home directory does not exist: ${this.hiveDir}`);
    }

    // Check if gateway is running
    const running = await this.isRunning();
    if (running) {
      info.push("Hive Gateway is running");

      // Check health endpoint
      const config = await this.getConfig();
      const healthy = await waitForHttpPort(config.gateway.port, "/health", 5000);

      if (healthy) {
        info.push("Hive health check passed");
      } else {
        warnings.push("Hive Gateway is running but health check failed");
      }
    } else {
      warnings.push("Hive Gateway is not running");
    }

    // Check for conflicting installations
    try {
      execSync("docker --version", { stdio: "ignore" });
      const dockerAdapter = new (await import("./docker")).DockerAdapter();
      const dockerInstalled = await dockerAdapter.detect();

      if (dockerInstalled) {
        info.push("Note: Docker installation also detected");
      }
    } catch {
      // Docker not installed, no conflict
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info,
    };
  }
}
