export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required: boolean;
  default?: string | number | boolean;
}

export interface ToolConfig {
  parameters: ToolParameter[];
  timeout: number;
  retries: number;
}

export interface ToolPermission {
  toolId: string;
  agentId: string;
  allowed: boolean;
  restrictions: string[];
}

export interface ToolUsageStat {
  toolId: string;
  agentId: string;
  invocations: number;
  successes: number;
  failures: number;
  avgDuration: number;
  lastUsed: string;
}

export interface Tool {
  id: string;
  name: string;
  description?: string | null;
  icon?: string;
  category?: string | null;
  config?: ToolConfig;
  permissions?: ToolPermission[];
  usageStats?: ToolUsageStat[];
  enabled: boolean;
  active?: boolean;
  version?: string;
}
