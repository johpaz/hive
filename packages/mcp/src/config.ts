export interface MCPConfig {
  servers?: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  /** "http" es Streamable HTTP, el transporte remoto estándar de MCP. "sse" es el HTTP+SSE original, de dos endpoints. */
  transport: "stdio" | "sse" | "websocket" | "http";
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
