/**
 * Tool Type Definitions
 * Shared across all tool categories
 * 
 * These types are shared by every native tool in Hive.
 */

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  /** Per-tool timeout (ms) override. Falls back to config.tools.timeouts[name] → workerPool.toolTimeoutMs. */
  timeoutMs?: number;
  execute: (
    params: Record<string, unknown>,
    config?: any
  ) => Promise<string | object>;
}

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | ToolParameter;
}

export interface ToolResult {
  ok: boolean;
  result?: any;
  error?: string;
  hint?: string;
}
