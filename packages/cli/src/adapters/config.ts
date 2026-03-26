/**
 * Configuration utilities for installation adapters
 * 
 * Provides shared configuration loading, validation, and normalization
 * across different installation methods.
 */

import { z } from "zod";
import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { GatewayConfig, InstallationConfig, InstallationPaths } from "./types";
import { DEFAULT_GATEWAY_CONFIG, PORTS, gatewayConfigSchema, installationConfigSchema } from "./types";

/**
 * Get the base Hive directory from environment or default
 */
export function getHiveDir(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }
  
  // Check environment variable
  if (process.env.HIVE_HOME) {
    return path.resolve(process.env.HIVE_HOME);
  }
  
  // Development mode
  if (process.env.HIVE_DEV === "true") {
    return path.join(process.env.HOME || "", ".hive-dev");
  }
  
  // Default production location
  return path.join(process.env.HOME || "", ".hive");
}

/**
 * Get default installation paths for the current environment
 */
export function getDefaultPaths(hiveDir?: string): InstallationPaths {
  const dir = getHiveDir(hiveDir);
  const dataDir = path.join(dir, "data");
  const logsDir = path.join(dir, "logs");
  
  return {
    hiveDir: dir,
    dbPath: path.join(dataDir, "hive.db"),
    logPath: path.join(logsDir, "gateway.log"),
    pidPath: path.join(dir, "gateway.pid"),
    uiDir: null, // Will be set by adapter
    workspaceDir: null, // Will be set from config
  };
}

/**
 * Load environment variables from .env file if it exists
 */
export function loadEnvFile(envPath?: string): Record<string, string> {
  const filePath = envPath || path.join(process.cwd(), ".env");
  
  if (!existsSync(filePath)) {
    return {};
  }
  
  try {
    const content = readFileSync(filePath, "utf-8");
    const env: Record<string, string> = {};
    
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").trim();
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, "");
        env[key.trim()] = cleanValue;
      }
    }
    
    return env;
  } catch {
    return {};
  }
}

/**
 * Merge environment variables with precedence
 */
export function mergeEnv(...envs: Array<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const env of envs) {
    Object.assign(result, env);
  }
  
  return result;
}

/**
 * Validate and normalize gateway configuration
 */
export function validateGatewayConfig(
  config: Partial<GatewayConfig>
): GatewayConfig {
  const merged = { ...DEFAULT_GATEWAY_CONFIG, ...config };
  
  try {
    return gatewayConfigSchema.parse(merged);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      throw new Error(`Invalid gateway configuration:\n${messages.join("\n")}`);
    }
    throw error;
  }
}

/**
 * Validate complete installation configuration
 */
export function validateInstallationConfig(
  config: unknown
): InstallationConfig {
  try {
    return installationConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      throw new Error(`Invalid installation configuration:\n${messages.join("\n")}`);
    }
    throw error;
  }
}

/**
 * Find a free port starting from the given port
 */
export async function findFreePort(startPort: number, maxAttempts: number = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    try {
      const server = Bun.serve({
        port,
        hostname: "0.0.0.0",
        fetch: () => new Response(""),
      });
      server.stop();
      return port;
    } catch {
      // Port is in use, try next
    }
  }
  throw new Error(`No free port found starting from ${startPort}`);
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      hostname: "0.0.0.0",
      fetch: () => new Response(""),
    });
    server.stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a port to become available
 */
export async function waitForPort(
  port: number,
  timeout: number = 30000,
  interval: number = 500
): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await isPortAvailable(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  
  return false;
}

/**
 * Wait for a port to respond to HTTP requests
 */
export async function waitForHttpPort(
  port: number,
  path: string = "/health",
  timeout: number = 30000
): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  return false;
}

/**
 * Expand a path that may contain ~ or environment variables
 */
export function expandPath(input: string): string {
  if (!input) {
    return input;
  }
  
  // Expand ~ to home directory
  if (input.startsWith("~/")) {
    return path.join(process.env.HOME || "", input.slice(2));
  }
  
  // Expand environment variables ${VAR} or $VAR
  return input.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (_, name) => {
    return process.env[name] || name;
  });
}

/**
 * Get the distribution directory where the binary is located
 */
export function getDistDir(): string | null {
  // Check environment variable
  if (process.env.HIVE_DIST_DIR) {
    return process.env.HIVE_DIST_DIR;
  }
  
  // Try to detect from process.argv
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return null;
  }
  
  const dir = path.dirname(scriptPath);
  
  // Check if we're in a dist directory
  if (path.basename(dir) === "dist") {
    return dir;
  }
  
  // Check if dist exists as a sibling
  const distPath = path.join(dir, "dist");
  if (existsSync(distPath)) {
    return distPath;
  }
  
  return null;
}

/**
 * Check if running in development mode
 *
 * Development mode is ONLY activated when HIVE_DEV is set to "true" or "1".
 * Otherwise, defaults to production mode.
 *
 * This is a simple and reliable check:
 * - Set HIVE_DEV=true in your development environment
 * - Production installations don't need to set anything
 */
export function isDevMode(): boolean {
  return process.env.HIVE_DEV === "true" || process.env.HIVE_DEV === "1";
}

/**
 * Check if running as a child process
 */
export function isChildProcess(): boolean {
  return process.env.HIVE_GATEWAY_CHILD === "1";
}

/**
 * Get platform-specific information
 */
export function getPlatformInfo(): {
  platform: string;
  arch: string;
  isLinux: boolean;
  isMac: boolean;
  isWindows: boolean;
} {
  const platform = process.platform;
  const arch = process.arch;
  
  return {
    platform,
    arch,
    isLinux: platform === "linux",
    isMac: platform === "darwin",
    isWindows: platform === "win32",
  };
}
