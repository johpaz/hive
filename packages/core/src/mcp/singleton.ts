/**
 * MCP Manager Singleton
 * 
 * Provides global access to the MCP Manager instance
 */

import type { MCPClientManager } from "@johpaz/hiveAgents-mcp";

let _mcpManager: MCPClientManager | null = null;

export function setMCPManager(m: MCPClientManager): void {
  _mcpManager = m;
}

export function getMCPManager(): MCPClientManager | null {
  return _mcpManager;
}

export function hasMCPManager(): boolean {
  return _mcpManager !== null;
}
