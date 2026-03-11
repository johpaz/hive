/**
 * Tool Type Definitions
 * Shared across all tool categories
 * 
 * These types are used by all 52 native tools in Hive
 */

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
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
