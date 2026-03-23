/**
 * Binary Adapter
 * 
 * Handles Hive installation via standalone compiled binary.
 * The binary includes embedded UI and requires no external dependencies.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import { existsSync, readFileSync, unlinkSync, chmodSync } from "node:fs";
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
  waitForHttpPort,
  isPortAvailable,
  getDistDir,
} from "./config";
import { PORTS } from "./types";

/**
 * Binary (standalone) installation adapter
 */
export class BinaryAdapter implements InstallationAdapter {
  readonly type = "binary" as const;
  readonly name = "Standalone Binary";

  private hiveDir: string;
  private pidFile: string;
  private binaryPath: string;

  constructor(options?: { hiveDir?: string; binaryPath?: string }) {
    this.hiveDir = options?.hiveDir || getHiveDir();
    this.pidFile = path.join(this.hiveDir, "gateway.pid");
    this.binaryPath = options?.binaryPath || this.findBinary();
  }

  /**
   * Find the Hive binary
   */
  private findBinary(): string {
    // Check if running as compiled binary
    const scriptPath = process.argv[1];
    if (scriptPath) {
      const dir = path.dirname(scriptPath);
      
      // Check if we're in dist directory
      if (path.basename(dir) === "dist") {
        const binaryInDist = path.join(dir, "hive");
        if (existsSync(binaryInDist)) {
          return binaryInDist;
        }
        
        const binaryWindows = path.join(dir, "hive.exe");
        if (existsSync(binaryWindows)) {
          return binaryWindows;
        }
      }
      
      // Check current executable
      if (existsSync(scriptPath) && !scriptPath.endsWith(".ts")) {
        return scriptPath;
      }
    }

    // Check common installation locations
    const commonPaths = [
      path.join(process.cwd(), "dist", "hive"),
      path.join(process.cwd(), "dist", "hive.exe"),
      "/usr/local/bin/hive",
      "/usr/bin/hive",
      path.join(process.env.HOME || "", ".local", "bin", "hive"),
      path.join(process.env.HOME || "", ".bun", "bin", "hive"),
    ];

    for (const binaryPath of commonPaths) {
      if (existsSync(binaryPath)) {
        return binaryPath;
      }
    }

    // Default to current process
    return process.execPath;
  }

  /**
   * Check if running as compiled binary
   */
  async detect(): Promise<boolean> {
    // Check if running as compiled binary (not from .ts source)
    const scriptPath = process.argv[1];
    
    if (!scriptPath) {
      return false;
    }

    // If running from .ts file, not compiled
    if (scriptPath.endsWith(".ts")) {
      return false;
    }

    // Check if binary exists
    if (existsSync(this.binaryPath)) {
      return true;
    }

    // Check for embedded UI bundle (indicates compiled binary)
    try {
      const { embeddedUI } = await import("../ui-bundle.generated");
      if (embeddedUI && embeddedUI.size > 0) {
        return true;
      }
    } catch {
      // No embedded UI, continue checking
    }

    // Check if HIVE_DIST_DIR is set and has UI
    const distDir = getDistDir();
    if (distDir) {
      const uiDir = path.join(distDir, "ui");
      if (existsSync(uiDir)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get Binary installation configuration
   */
  async getConfig(): Promise<InstallationConfig> {
    const env = await this.getEnvironment();
    const paths = getDefaultPaths(this.hiveDir);

    // Binary uses embedded UI or UI from dist directory
    const distDir = getDistDir();
    if (distDir) {
      const uiDir = path.join(distDir, "ui");
      if (existsSync(uiDir)) {
        paths.uiDir = uiDir;
      }
    }

    // Check for embedded UI
    let hasEmbeddedUI = false;
    try {
      const { embeddedUI } = await import("../ui-bundle.generated");
      hasEmbeddedUI = embeddedUI && embeddedUI.size > 0;
    } catch {
      hasEmbeddedUI = false;
    }

    if (hasEmbeddedUI) {
      paths.uiDir = null; // Embedded, not filesystem
    }

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
      isDev: false,
      hasEmbeddedUI,
    };
  }

  /**
   * Start Hive using the compiled binary
   */
  async start(config: GatewayConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ["start", "--skip-check"];

      if (config.daemon) {
        args.push("--daemon");
      }

      const child = spawn(this.binaryPath, args, {
        stdio: "inherit",
        detached: false,
        env: mergeEnv(process.env, {
          HIVE_HOME: this.hiveDir,
          HIVE_GATEWAY_CHILD: "0",
        }),
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Hive binary exited with code ${code}`));
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
          const pattern = process.platform === "win32" ? "hive.exe" : "hive";
          execSync(`pkill -f "${pattern}"`, { stdio: "ignore" });
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
   * Get Binary environment variables
   */
  async getEnvironment(): Promise<Record<string, string>> {
    const fileEnv = loadEnvFile();
    const homeEnv = loadEnvFile(path.join(this.hiveDir, ".env"));

    const defaults = {
      HIVE_HOST: "127.0.0.1",
      HIVE_PORT: String(PORTS.GATEWAY),
      HIVE_HOME: this.hiveDir,
      HIVE_UI_DIR: process.env.HIVE_UI_DIR || "",
      NO_BROWSER: "0",
      HIVE_PUBLIC_URL: "",
      HIVE_DAEMON: "0",
      NODE_ENV: "production",
    };

    return mergeEnv(defaults, fileEnv, homeEnv, process.env);
  }

  /**
   * Validate Binary installation
   */
  async validate(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    // Check binary existence
    if (existsSync(this.binaryPath)) {
      info.push(`Binary: ${this.binaryPath}`);
      
      try {
        const stat = await import("node:fs/promises").then(m => m.stat(this.binaryPath));
        if (stat && !stat.isDirectory()) {
          const sizeKB = (stat.size / 1024).toFixed(1);
          info.push(`Binary size: ${sizeKB} KB`);
        }
      } catch {
        // Ignore stat errors
      }
    } else {
      errors.push("Hive binary not found");
    }

    // Check for embedded UI
    let hasEmbeddedUI = false;
    try {
      const { embeddedUI } = await import("../ui-bundle.generated");
      if (embeddedUI && embeddedUI.size > 0) {
        hasEmbeddedUI = true;
        info.push(`Embedded UI: ${embeddedUI.size} files`);
      }
    } catch {
      // No embedded UI
    }

    // Check for filesystem UI
    const distDir = getDistDir();
    if (distDir) {
      const uiDir = path.join(distDir, "ui");
      if (existsSync(uiDir)) {
        info.push(`UI directory: ${uiDir}`);
      } else if (!hasEmbeddedUI) {
        warnings.push("UI directory not found and no embedded UI");
      }
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

    // Check binary permissions (Unix-like systems)
    if (process.platform !== "win32" && existsSync(this.binaryPath)) {
      try {
        execSync(`test -x "${this.binaryPath}"`, { stdio: "ignore" });
        info.push("Binary is executable");
      } catch {
        warnings.push("Binary may not be executable (try: chmod +x <binary>)");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info,
    };
  }
}
