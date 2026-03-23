/**
 * Installation Adapter Factory
 * 
 * Provides automatic detection and instantiation of the appropriate
 * installation adapter based on the current environment.
 */

import type { InstallationAdapter, InstallationType, AdapterOptions } from "./types";
import { DockerAdapter } from "./docker";
import { BunGlobalAdapter } from "./bun-global";
import { BinaryAdapter } from "./binary";

/**
 * Priority order for adapter detection
 * Lower number = higher priority
 */
const DETECTION_PRIORITY: InstallationType[] = [
  "docker",            // Standard Docker
  "binary",            // Compiled binary
  "bun-global",        // Global npm installation
];

/**
 * Create adapter instances for all available types
 */
function createAllAdapters(options?: { hiveDir?: string }): Record<InstallationType, InstallationAdapter> {
  return {
    "docker": new DockerAdapter({ hiveDir: options?.hiveDir }),
    "bun-global": new BunGlobalAdapter({ hiveDir: options?.hiveDir }),
    "binary": new BinaryAdapter({ hiveDir: options?.hiveDir }),
  };
}

/**
 * Detect and return the appropriate installation adapter
 * 
 * Detection strategy:
 * 1. If forceType is specified, use that adapter
 * 2. Check for Hostinguer configuration (most specific)
 * 3. Check for standard Docker installation
 * 4. Check for compiled binary
 * 5. Check for global Bun installation
 * 6. Default to BinaryAdapter (embedded UI fallback)
 */
export async function detectAdapter(options?: AdapterOptions): Promise<InstallationAdapter> {
  const hiveDir = options?.hiveDir;
  const verbose = options?.verbose ?? false;

  // Force specific adapter type
  if (options?.forceType) {
    const adapters = createAllAdapters({ hiveDir });
    const adapter = adapters[options.forceType];
    
    if (verbose) {
      console.log(`Using forced adapter: ${adapter.name} (${options.forceType})`);
    }
    
    return adapter;
  }

  // Try detection in priority order
  const adapters = createAllAdapters({ hiveDir });

  for (const type of DETECTION_PRIORITY) {
    const adapter = adapters[type];
    
    try {
      const isDetected = await adapter.detect();
      
      if (isDetected) {
        if (verbose) {
          console.log(`Detected installation: ${adapter.name} (${type})`);
        }
        return adapter;
      }
    } catch (error) {
      if (verbose) {
        console.warn(`Error detecting ${type}:`, (error as Error).message);
      }
      // Continue to next adapter
    }
  }

  // Fallback: return BinaryAdapter as default
  // This handles cases where we're running from source or embedded
  if (verbose) {
    console.log("No specific installation detected, using BinaryAdapter (fallback)");
  }
  
  return adapters.binary;
}

/**
 * Detect all available installation methods
 * Returns an array of adapters that detected successfully
 */
export async function detectAllAdapters(options?: { hiveDir?: string }): Promise<InstallationAdapter[]> {
  const adapters = createAllAdapters({ hiveDir: options?.hiveDir });
  const available: InstallationAdapter[] = [];

  for (const type of DETECTION_PRIORITY) {
    const adapter = adapters[type];
    
    try {
      if (await adapter.detect()) {
        available.push(adapter);
      }
    } catch {
      // Adapter detection failed, skip
    }
  }

  return available;
}

/**
 * Get the primary installation type
 */
export async function getInstallationType(options?: { hiveDir?: string }): Promise<InstallationType> {
  const adapter = await detectAdapter({ hiveDir: options?.hiveDir });
  return adapter.type;
}

/**
 * Check if a specific installation type is available
 */
export async function isInstallationTypeAvailable(
  type: InstallationType,
  options?: { hiveDir?: string }
): Promise<boolean> {
  const adapters = createAllAdapters({ hiveDir: options?.hiveDir });
  const adapter = adapters[type];
  
  try {
    return await adapter.detect();
  } catch {
    return false;
  }
}

/**
 * Get adapter by type
 */
export function getAdapterByType(
  type: InstallationType,
  options?: { hiveDir?: string }
): InstallationAdapter {
  const adapters = createAllAdapters({ hiveDir: options?.hiveDir });
  return adapters[type];
}

/**
 * Installation type display names
 */
export const INSTALLATION_TYPE_NAMES: Record<InstallationType, string> = {
  "docker": "Docker Compose",
  "bun-global": "Bun Global (npm-style)",
  "binary": "Standalone Binary",
};

/**
 * Installation type descriptions
 */
export const INSTALLATION_TYPE_DESCRIPTIONS: Record<InstallationType, string> = {
  "docker": "Standard Docker Compose installation with named volumes",
  "bun-global": "Global installation via `bun install -g @johpaz/hive-agents`",
  "binary": "Standalone compiled binary with embedded UI (or Docker container)",
};
