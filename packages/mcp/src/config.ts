export interface MCPConfig {
  servers?: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  transport: "stdio" | "sse" | "websocket";
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
