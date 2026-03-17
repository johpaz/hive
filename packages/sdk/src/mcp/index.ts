/**
 * Hive SDK - MCP Module
 *
 * Exposes the MCP adapter and server connection functions.
 *
 * @example
 * import { MCPClientManager } from "@johpaz/hive-sdk/mcp";
 *
 * // Connect to an MCP server
 * const manager = new MCPClientManager({ servers: {} });
 */

export { MCPClientManager, type MCPTool, type MCPResource, type MCPPrompt } from "@johpaz/hive/mcp/manager";

export type { MCPConfig, MCPServerConfig } from "@johpaz/hive/mcp/config";

export { logger } from "@johpaz/hive/mcp/logger";
