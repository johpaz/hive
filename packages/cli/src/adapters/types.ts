/**
 * Installation Adapter System
 * 
 * Provides a unified interface for different Hive installation methods:
 * - Docker Compose (standard)
 * - Bun Global (npm-style installation)
 * - Binary (standalone compiled binary)
 */

import { z } from "zod";

/**
 * Installation type identifier
 */
export type InstallationType = "docker" | "bun-global" | "binary";

/**
 * Installation paths for different methods
 */
export interface InstallationPaths {
  /** Base directory for Hive data and configuration */
  hiveDir: string;
  /** Database file path */
  dbPath: string;
  /** Log file path */
  logPath: string;
  /** PID file path */
  pidPath: string;
  /** UI assets directory (null for embedded UI, undefined if not set) */
  uiDir?: string | null;
  /** Workspace directory for agent file access (undefined if not set) */
  workspaceDir?: string | null;
}

/**
 * Runtime configuration for the gateway
 */
export interface GatewayConfig {
  /** Host to bind the gateway server */
  host: string;
  /** Port for the gateway HTTP server */
  port: number;
  /** Port for the UI server (if separate) */
  uiPort?: number;
  /** WebSocket port for real-time connections */
  wsPort: number;
  /** Code Bridge port for development tools */
  codeBridgePort: number;
  /** Public URL for external access */
  publicUrl?: string;
  /** Whether to open browser on start */
  openBrowser: boolean;
  /** Whether to run as daemon */
  daemon: boolean;
}

/**
 * Complete installation configuration
 */
export interface InstallationConfig {
  /** Installation type */
  type: InstallationType;
  /** Gateway runtime configuration */
  gateway: GatewayConfig;
  /** File paths */
  paths: InstallationPaths;
  /** Environment variables */
  env: Record<string, string>;
  /** Whether this is a development installation */
  isDev: boolean;
  /** Whether UI is embedded in binary */
  hasEmbeddedUI: boolean;
}

/**
 * Installation adapter interface
 * 
 * Each installation method implements this interface to provide
 * a consistent API for the gateway and CLI commands.
 */
export interface InstallationAdapter {
  /**
   * Installation type identifier
   */
  readonly type: InstallationType;

  /**
   * Human-readable name for this installation method
   */
  readonly name: string;

  /**
   * Detect if this installation method is available
   * @returns true if this method can be used in the current environment
   */
  detect(): Promise<boolean>;

  /**
   * Get the installation configuration
   * @returns Configuration object with paths, ports, and settings
   */
  getConfig(): Promise<InstallationConfig>;

  /**
   * Start the Hive gateway using this installation method
   * @param config Gateway configuration
   */
  start(config: GatewayConfig): Promise<void>;

  /**
   * Stop the Hive gateway
   */
  stop(): Promise<void>;

  /**
   * Check if the gateway is currently running
   * @returns true if gateway is running
   */
  isRunning(): Promise<boolean>;

  /**
   * Get the process ID of the running gateway
   * @returns PID or null if not running
   */
  getPid(): Promise<number | null>;

  /**
   * Get installation-specific environment variables
   * @returns Environment variables object
   */
  getEnvironment(): Promise<Record<string, string>>;

  /**
   * Validate the installation
   * @returns Validation result with any errors or warnings
   */
  validate(): Promise<ValidationResult>;
}

/**
 * Validation result for installation health checks
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** List of validation warnings */
  warnings: string[];
  /** List of validation info messages */
  info: string[];
}

/**
 * Adapter factory options
 */
export interface AdapterOptions {
  /** Force a specific adapter type (skip auto-detection) */
  forceType?: InstallationType;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom Hive home directory */
  hiveDir?: string;
}

/**
 * Schema for gateway configuration validation
 */
export const gatewayConfigSchema = z.object({
  host: z.string().optional().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(18790),
  uiPort: z.number().int().min(1).max(65535).optional(),
  wsPort: z.number().int().min(1).max(65535).default(18790),
  codeBridgePort: z.number().int().min(1).max(65535).default(18791),
  publicUrl: z.string().url().optional(),
  openBrowser: z.boolean().default(true),
  daemon: z.boolean().default(false),
});

/**
 * Schema for installation paths validation
 */
export const installationPathsSchema = z.object({
  hiveDir: z.string(),
  dbPath: z.string(),
  logPath: z.string(),
  pidPath: z.string(),
  uiDir: z.string().nullable().optional(),
  workspaceDir: z.string().nullable().optional(),
});

/**
 * Schema for complete installation configuration validation
 */
export const installationConfigSchema = z.object({
  type: z.enum(["docker", "bun-global", "binary"]),
  gateway: gatewayConfigSchema,
  paths: installationPathsSchema,
  env: z.record(z.string(), z.string()),
  isDev: z.boolean(),
  hasEmbeddedUI: z.boolean(),
});

/**
 * Default gateway configuration
 */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  host: "127.0.0.1",
  port: 18790,
  wsPort: 18790,
  codeBridgePort: 18791,
  openBrowser: true,
  daemon: false,
};

/**
 * Common ports used by Hive
 */
export const PORTS = {
  GATEWAY: 18790,
  CODE_BRIDGE: 18791,
  VITE_DEV: 5173,
} as const;
