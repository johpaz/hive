/**
 * Installation Adapters
 * 
 * Unified interface for different Hive installation methods.
 * Each adapter handles the specifics of its installation type,
 * providing a consistent API for gateway management.
 * 
 * @example
 * ```typescript
 * import { detectAdapter } from "@johpaz/hive-agents-cli/adapters";
 * 
 * const adapter = await detectAdapter();
 * console.log(`Detected: ${adapter.name}`);
 * 
 * const config = await adapter.getConfig();
 * console.log(`Gateway port: ${config.gateway.port}`);
 * 
 * const validation = await adapter.validate();
 * if (!validation.valid) {
 *   console.error("Validation errors:", validation.errors);
 * }
 * ```
 * 
 * @packageDocumentation
 */

// Types and interfaces
export type {
  InstallationType,
  InstallationAdapter,
  InstallationConfig,
  InstallationPaths,
  GatewayConfig,
  ValidationResult,
  AdapterOptions,
} from "./types";

// Constants and schemas
export {
  DEFAULT_GATEWAY_CONFIG,
  PORTS,
  gatewayConfigSchema,
  installationPathsSchema,
  installationConfigSchema,
} from "./types";

// Configuration utilities
export {
  getHiveDir,
  getDefaultPaths,
  loadEnvFile,
  mergeEnv,
  validateGatewayConfig,
  validateInstallationConfig,
  findFreePort,
  isPortAvailable,
  waitForPort,
  waitForHttpPort,
  expandPath,
  getDistDir,
  isDevMode,
  isChildProcess,
  getPlatformInfo,
} from "./config";

// Adapters
export { DockerAdapter } from "./docker";
export { BunGlobalAdapter } from "./bun-global";
export { BinaryAdapter } from "./binary";

// Factory and detection
export {
  detectAdapter,
  detectAllAdapters,
  getInstallationType,
  isInstallationTypeAvailable,
  getAdapterByType,
  INSTALLATION_TYPE_NAMES,
  INSTALLATION_TYPE_DESCRIPTIONS,
} from "./factory";
