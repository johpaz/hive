/**
 * Docker Compose Adapter
 * 
 * Handles Hive installation via Docker Compose (standard configuration).
 * Uses docker-compose.yml with named volumes and host.docker.internal.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import { existsSync } from "node:fs";
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
} from "./config";
import { PORTS } from "./types";

/**
 * Docker Compose installation adapter
 */
export class DockerAdapter implements InstallationAdapter {
  readonly type = "docker" as const;
  readonly name = "Docker Compose";

  private hiveDir: string;
  private composeFile: string;
  private envFile: string;

  constructor(options?: { hiveDir?: string; composeFile?: string }) {
    this.hiveDir = options?.hiveDir || getHiveDir();
    this.composeFile = options?.composeFile || this.findComposeFile();
    this.envFile = path.join(path.dirname(this.composeFile), ".env");
  }

  /**
   * Find the docker-compose.yml file
   */
  private findComposeFile(): string {
    // Only check standard installation locations — NOT process.cwd().
    // Searching cwd causes false positives when running from the dev/source directory.
    const standardPaths = [
      "/opt/hive/docker-compose.yml",
      "/usr/local/share/hive/docker-compose.yml",
      path.join(process.env.HOME || "", ".hive", "docker-compose.yml"),
    ];

    for (const composePath of standardPaths) {
      if (existsSync(composePath)) {
        return composePath;
      }
    }

    // Default to a path that won't exist → detect() will return false gracefully
    return "/opt/hive/docker-compose.yml";
  }

  /**
   * Check if Docker is available and this installation method is active
   */
  async detect(): Promise<boolean> {
    try {
      // Check if Docker is installed
      execSync("docker --version", { stdio: "ignore" });
      
      // Check if docker-compose is available
      execSync("docker compose version", { stdio: "ignore" });
      
      // Check if compose file exists
      if (!existsSync(this.composeFile)) {
        return false;
      }

      // Verify the compose file actually defines a "hive" service.
      // Use "config --services" instead of "ps" so it works even when containers are stopped.
      try {
        const out = execSync(
          `docker compose -f "${this.composeFile}" config --services`,
          { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
        );
        return out.trim().split("\n").map(s => s.trim()).includes("hive");
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get Docker-specific installation configuration
   */
  async getConfig(): Promise<InstallationConfig> {
    const env = await this.getEnvironment();
    const paths = getDefaultPaths(this.hiveDir);
    
    // In Docker mode, UI is served from /app/ui inside container
    // but we access it via the exposed port
    paths.uiDir = null;

    const port = parseInt(env.HIVE_PORT || "18790", 10) || PORTS.GATEWAY;
    const publicUrl = env.HIVE_PUBLIC_URL || undefined;

    return {
      type: this.type,
      gateway: {
        host: env.HIVE_HOST || "0.0.0.0",
        port,
        wsPort: port,
        codeBridgePort: PORTS.CODE_BRIDGE,
        publicUrl,
        openBrowser: !env.NO_BROWSER,
        daemon: false,
      },
      paths,
      env,
      isDev: false,
      hasEmbeddedUI: false,
    };
  }

  /**
   * Start Hive using Docker Compose
   */
  async start(config: GatewayConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["compose", "-f", this.composeFile, "up", "-d"], {
        stdio: "inherit",
        detached: false,
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker compose exited with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop Hive Docker container
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["compose", "-f", this.composeFile, "down"], {
        stdio: "inherit",
        detached: false,
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker compose down exited with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
   * Check if Docker container is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const output = execSync("docker compose ps --format json", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      const services = JSON.parse(output.trim());
      if (Array.isArray(services)) {
        const hive = services.find((s: any) => s.service === "hive");
        return hive && hive.state === "running";
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker container PID (not directly accessible, returns null)
   */
  async getPid(): Promise<number | null> {
    try {
      const output = execSync("docker inspect --format '{{.State.Pid}}' $(docker compose ps -q hive)", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      const pid = parseInt(output.trim(), 10);
      if (!isNaN(pid) && pid > 0) {
        return pid;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get Docker-specific environment variables
   */
  async getEnvironment(): Promise<Record<string, string>> {
    const fileEnv = loadEnvFile(this.envFile);
    
    const defaults = {
      HIVE_HOST: "0.0.0.0",
      HIVE_PORT: String(PORTS.GATEWAY),
      OLLAMA_HOST: "http://host.docker.internal:11434",
      NO_BROWSER: "1",
      HIVE_PUBLIC_URL: "",
    };

    return mergeEnv(defaults, fileEnv, process.env);
  }

  /**
   * Validate Docker installation
   */
  async validate(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    // Check Docker installation
    try {
      const version = execSync("docker --version", { encoding: "utf-8" }).trim();
      info.push(`Docker: ${version}`);
    } catch {
      errors.push("Docker is not installed or not in PATH");
    }

    // Check docker-compose
    try {
      const version = execSync("docker compose version", { encoding: "utf-8" }).trim();
      info.push(`Docker Compose: ${version}`);
    } catch {
      errors.push("Docker Compose is not installed");
    }

    // Check compose file
    if (!existsSync(this.composeFile)) {
      errors.push(`docker-compose.yml not found at ${this.composeFile}`);
    } else {
      info.push(`Compose file: ${this.composeFile}`);
    }

    // Check if Docker daemon is running
    try {
      execSync("docker info", { stdio: "ignore" });
      info.push("Docker daemon is running");
    } catch {
      errors.push("Docker daemon is not running");
    }

    // Check container health if running
    const running = await this.isRunning();
    if (running) {
      info.push("Hive container is running");
      
      // Check health endpoint
      const config = await this.getConfig();
      const healthy = await waitForHttpPort(config.gateway.port, "/health", 5000);
      
      if (healthy) {
        info.push("Hive health check passed");
      } else {
        warnings.push("Hive container is running but health check failed");
      }
    } else {
      warnings.push("Hive container is not running");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info,
    };
  }
}
