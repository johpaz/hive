/**
 * Docker Compose Hostinguer Adapter
 * 
 * Handles Hive installation via Docker Compose with Traefik reverse proxy.
 * Used for production deployments with SSL and custom domains.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
} from "./config";
import { PORTS } from "./types";

/**
 * Docker Compose Hostinguer installation adapter
 */
export class DockerHostinguerAdapter implements InstallationAdapter {
  readonly type = "docker-hostinguer" as const;
  readonly name = "Docker Compose (Hostinguer)";

  private hiveDir: string;
  private composeFile: string;
  private envFile: string;

  constructor(options?: { hiveDir?: string; composeFile?: string }) {
    this.hiveDir = options?.hiveDir || getHiveDir();
    this.composeFile = options?.composeFile || this.findComposeFile();
    this.envFile = path.join(path.dirname(this.composeFile), ".env");
  }

  /**
   * Find the docker-compose.hostinguer.yml file
   */
  private findComposeFile(): string {
    // Check current directory
    const localCompose = path.join(process.cwd(), "docker-compose.hostinguer.yml");
    if (existsSync(localCompose)) {
      return localCompose;
    }

    // Check common installation locations
    const commonPaths = [
      "/opt/hive/docker-compose.hostinguer.yml",
      "/usr/local/share/hive/docker-compose.hostinguer.yml",
      path.join(process.env.HOME || "", ".hive", "docker-compose.hostinguer.yml"),
    ];

    for (const composePath of commonPaths) {
      if (existsSync(composePath)) {
        return composePath;
      }
    }

    // Default to current directory (will fail gracefully)
    return localCompose;
  }

  /**
   * Check if this Hostinguer installation is active
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

      // Check for Traefik labels in compose file
      const content = readFileSync(this.composeFile, "utf-8");
      if (!content.includes("traefik.enable")) {
        return false;
      }

      // Check if Hive container is defined
      try {
        const output = execSync("docker compose ps --format json", {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        
        const services = JSON.parse(output.trim());
        if (Array.isArray(services)) {
          return services.some((s: any) => s.service === "hive");
        }
      } catch {
        // Container may not be running, but installation exists
        return true;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Hostinguer-specific installation configuration
   */
  async getConfig(): Promise<InstallationConfig> {
    const env = await this.getEnvironment();
    const paths = getDefaultPaths(this.hiveDir);
    
    // In Docker mode, UI is served from container
    paths.uiDir = null;

    const port = parseInt(env.HIVE_PORT || "18790", 10) || PORTS.GATEWAY;
    const publicUrl = env.HIVE_PUBLIC_URL || env.HIVE_DOMAIN || undefined;
    const domain = env.HIVE_DOMAIN || "";

    return {
      type: this.type,
      gateway: {
        host: env.HIVE_HOST || "0.0.0.0",
        port,
        wsPort: port,
        codeBridgePort: PORTS.CODE_BRIDGE,
        publicUrl: publicUrl || (domain ? `https://${domain}` : undefined),
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
   * Start Hive using Docker Compose with Traefik
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
   * Get Hostinguer-specific environment variables
   */
  async getEnvironment(): Promise<Record<string, string>> {
    const fileEnv = loadEnvFile(this.envFile);
    
    const defaults = {
      HIVE_HOST: "0.0.0.0",
      HIVE_PORT: String(PORTS.GATEWAY),
      OLLAMA_HOST: "http://host.docker.internal:11434",
      NO_BROWSER: "1",
      HIVE_PUBLIC_URL: "",
      HIVE_DOMAIN: "",
    };

    return mergeEnv(defaults, fileEnv, process.env);
  }

  /**
   * Validate Hostinguer installation
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
      errors.push(`docker-compose.hostinguer.yml not found at ${this.composeFile}`);
    } else {
      info.push(`Compose file: ${this.composeFile}`);
      
      // Check for Traefik configuration
      const content = readFileSync(this.composeFile, "utf-8");
      if (content.includes("traefik.enable")) {
        info.push("Traefik integration detected");
      } else {
        warnings.push("No Traefik labels found in compose file");
      }
    }

    // Check environment file
    if (existsSync(this.envFile)) {
      const env = loadEnvFile(this.envFile);
      if (env.HIVE_DOMAIN) {
        info.push(`Domain: ${env.HIVE_DOMAIN}`);
      } else {
        warnings.push("HIVE_DOMAIN not configured in .env");
      }
      
      if (env.HIVE_PUBLIC_URL) {
        info.push(`Public URL: ${env.HIVE_PUBLIC_URL}`);
      }
    } else {
      warnings.push(".env file not found");
    }

    // Check if Docker daemon is running
    try {
      execSync("docker info", { stdio: "ignore" });
      info.push("Docker daemon is running");
    } catch {
      errors.push("Docker daemon is not running");
    }

    // Check Traefik network
    try {
      execSync("docker network ls --filter name=n8n_evoapi --format '{{.Name}}'", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      info.push("Traefik network (n8n_evoapi) exists");
    } catch {
      warnings.push("Traefik network 'n8n_evoapi' not found");
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
