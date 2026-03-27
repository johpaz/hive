/**
 * CLI Tool Configurations for Code Bridge
 * 
 * This module provides centralized configuration for all supported CLI AI tools.
 * Each CLI has specific flags for non-interactive mode, approval handling, and timeouts.
 * 
 * @see https://github.com/johpaz/hive/packages/code-bridge
 */

/**
 * Configuration for a specific CLI tool
 */
export interface CliConfig {
  /** Command to execute the CLI (e.g., "claude", "qwen") */
  cmd: string;
  
  /** Default arguments for non-interactive/headless mode */
  defaultArgs: string[];
  
  /** Environment variables required by this CLI */
  envVars: string[];
  
  /** Default timeout in seconds before auto-kill */
  timeoutSeconds: number;
  
  /** Whether stdin should be closed after writing the prompt */
  requiresStdinClose: boolean;
  
  /** Flag to disable approval prompts (if applicable) */
  approvalFlag?: string;
  
  /** Flag to enable headless/non-interactive mode (if applicable) */
  headlessFlag?: string;
  
  /** Description for documentation purposes */
  description: string;
  
  /** Common use cases for this CLI */
  useCases: string[];
}

/**
 * Centralized configuration for all supported CLI tools
 * 
 * Key considerations:
 * - Some CLIs require approval before file operations (Claude Code)
 * - Some CLIs need stdin closed to finalize execution (Qwen)
 * - Timeouts vary based on typical operation complexity
 */
export const CLI_CONFIGS: Record<string, CliConfig> = {
  /**
   * Claude Code - Anthropic's CLI tool
   * 
   * Characteristics:
   * - Requires --no-approve flag to avoid interactive approval prompts
   * - Best for complex code architecture and refactoring
   * - Supports streaming output format
   */
  claude: {
    cmd: "claude",
    defaultArgs: ["--no-approve", "--output-format", "stream"],
    envVars: ["ANTHROPIC_API_KEY"],
    timeoutSeconds: 300, // 5 minutes - Claude often does deep analysis
    requiresStdinClose: false,
    approvalFlag: "--no-approve",
    description: "Anthropic's Claude Code CLI - Best for complex architecture and refactoring",
    useCases: [
      "Code architecture and design",
      "Complex refactoring tasks",
      "Security-focused code review",
      "Documentation generation",
    ],
  },

  /**
   * Qwen CLI - Alibaba's Code-focused AI
   *
   * Characteristics:
   * - Uses -p/--prompt for non-interactive mode (positional prompt)
   * - Needs stdin closed after prompt to finalize
   * - Fast for code generation and debugging
   * - Requires --yolo flag to auto-approve tool operations
   */
  qwen: {
    cmd: "qwen",
    defaultArgs: ["--yolo"],
    envVars: [],
    timeoutSeconds: 300, // 5 minutes - Need more time for complex tasks
    requiresStdinClose: false, // Not needed when using -p flag
    approvalFlag: "--yolo",
    headlessFlag: "-p",
    description: "Alibaba's Qwen CLI - Fast code generation and debugging",
    useCases: [
      "Quick code generation",
      "Bug fixes and debugging",
      "Utility functions",
      "Boilerplate code",
    ],
  },

  /**
   * Gemini CLI - Google's AI Assistant
   * 
   * Characteristics:
   * - Uses -y or --quiet for auto-confirm
   * - Good balance of speed and quality
   * - Supports multi-language code generation
   */
  gemini: {
    cmd: "gemini",
    defaultArgs: ["-y", "--quiet"],
    envVars: ["GOOGLE_API_KEY"],
    timeoutSeconds: 240, // 4 minutes
    requiresStdinClose: false,
    approvalFlag: "-y",
    headlessFlag: "--no-interactive",
    description: "Google's Gemini CLI - Balanced code generation with documentation",
    useCases: [
      "Code + documentation pairs",
      "Multi-language projects",
      "API integration code",
      "Test generation",
    ],
  },

  /**
   * OpenCode - Open Source Code Generator
   * 
   * Characteristics:
   * - Most flexible, least restrictive
   * - --headless and --auto-accept for automation
   * - Good for open source patterns
   */
  opencode: {
    cmd: "opencode",
    defaultArgs: ["--headless", "--auto-accept"],
    envVars: [],
    timeoutSeconds: 200, // ~3.5 minutes
    requiresStdinClose: false,
    approvalFlag: "--auto-accept",
    headlessFlag: "--headless",
    description: "OpenCode CLI - Flexible, open source focused",
    useCases: [
      "Open source project scaffolding",
      "Multi-language support",
      "Community-driven patterns",
      "Rapid prototyping",
    ],
  },
};

/**
 * Get configuration for a specific CLI tool
 * 
 * @param cliName - Name of the CLI tool (e.g., "claude", "qwen")
 * @returns CLI configuration or undefined if not found
 * 
 * @example
 * ```typescript
 * const config = getCliConfig("claude");
 * if (config) {
 *   console.log(`Running ${config.cmd} with timeout ${config.timeoutSeconds}s`);
 * }
 * ```
 */
export function getCliConfig(cliName: string): CliConfig | undefined {
  const normalized = cliName.toLowerCase().trim();
  return CLI_CONFIGS[normalized];
}

/**
 * Get all available CLI tool names
 * 
 * @returns Array of available CLI names
 * 
 * @example
 * ```typescript
 * const available = getAvailableCliNames();
 * // ["claude", "qwen", "gemini", "opencode"]
 * ```
 */
export function getAvailableCliNames(): string[] {
  return Object.keys(CLI_CONFIGS);
}

/**
 * Build command arguments for a CLI tool
 * 
 * Combines default args with any additional user-provided args.
 * Ensures headless/approval flags are present if not already included.
 * 
 * @param cliName - Name of the CLI tool
 * @param extraArgs - Additional arguments to append
 * @returns Complete argument array
 * 
 * @example
 * ```typescript
 * const args = buildCliArgs("claude", ["--model", "claude-sonnet-4-20250514"]);
 * // ["--no-approve", "--output-format", "stream", "--model", "claude-sonnet-4-20250514"]
 * ```
 */
export function buildCliArgs(cliName: string, extraArgs: string[] = []): string[] {
  const config = getCliConfig(cliName);
  if (!config) {
    // Unknown CLI - return extra args as-is
    return extraArgs;
  }

  const args = [...config.defaultArgs];
  
  // Add extra args, avoiding duplicates
  for (const arg of extraArgs) {
    if (!args.includes(arg)) {
      args.push(arg);
    }
  }

  return args;
}

/**
 * Validate that required environment variables are set for a CLI
 * 
 * @param cliName - Name of the CLI tool
 * @returns Object with validation result and missing variables
 * 
 * @example
 * ```typescript
 * const validation = validateCliEnv("claude");
 * if (!validation.valid) {
 *   console.error(`Missing: ${validation.missing.join(", ")}`);
 * }
 * ```
 */
export function validateCliEnv(cliName: string): { valid: boolean; missing: string[] } {
  const config = getCliConfig(cliName);
  if (!config) {
    return { valid: true, missing: [] }; // Unknown CLI - assume OK
  }

  const missing: string[] = [];
  
  for (const envVar of config.envVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get the effective timeout for a CLI process
 * 
 * Returns the configured timeout, or a default if CLI is unknown.
 * 
 * @param cliName - Name of the CLI tool
 * @param override - Optional override timeout in seconds
 * @returns Timeout in seconds
 */
export function getCliTimeout(cliName: string, override?: number): number {
  if (override !== undefined) {
    return override;
  }
  
  const config = getCliConfig(cliName);
  return config?.timeoutSeconds ?? 120; // Default 2 minutes for unknown CLIs
}

/**
 * Check if a CLI requires stdin to be closed after prompt
 * 
 * @param cliName - Name of the CLI tool
 * @returns true if stdin should be closed
 */
export function requiresStdinClose(cliName: string): boolean {
  const config = getCliConfig(cliName);
  return config?.requiresStdinClose ?? false;
}
