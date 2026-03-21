/**
 * @johpaz/hive-agents-sdk
 * 
 * Hive SDK - Build on top of Hive for enterprise and custom integrations.
 * 
 * This package exposes all internal Hive functionality as a clean, organized API
 * for developers who want to build on top of Hive, including hive-cloud Enterprise.
 * 
 * @example
 * import { runAgent, AgentService } from "@johpaz/hive-agents-sdk/agents";
 * import { createAllTools } from "@johpaz/hive-agents-sdk/tools";
 * import { SkillLoader } from "@johpaz/hive-agents-sdk/skills";
 * import { MCPClientManager } from "@johpaz/hive-agents-sdk/mcp";
 * import { ChannelManager } from "@johpaz/hive-agents-sdk/channels";
 * import { getDb, initDatabase } from "@johpaz/hive-agents-sdk/database";
 * 
 * // Or import everything
 * import * as HiveSDK from "@johpaz/hive-agents-sdk";
 */

export * from "./agents/index";
export * from "./tools/index";
export * from "./skills/index";
export * from "./mcp/index";
export * from "./channels/index";
export * from "./cron/index";
export * from "./ethics/index";
export * from "./database/index";
export * from "./types/index";

export const SDK_VERSION = "1.0.0";
