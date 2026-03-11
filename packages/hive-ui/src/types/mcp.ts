export type MCPServerStatus = "connected" | "disconnected" | "error" | "connecting" | "not_configured";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export interface MCPConfig {
  url?: string;
  command?: string;
  args?: string[];
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryPolicy?: "none" | "linear" | "exponential";
}

export interface MCPServer {
  id: string;
  name: string;
  description?: string;
  url?: string;
  status: MCPServerStatus;
  enabled: boolean;
  active?: boolean;
  config?: MCPConfig;
  tools?: MCPTool[];
  tools_count: number;
  connectedAgents?: string[];
  lastPing?: string;
  addedAt?: string;
  transport?: string;
  builtin?: boolean;
}
