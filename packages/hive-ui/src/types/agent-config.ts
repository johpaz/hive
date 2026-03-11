import type { EthicsConfig } from "./ethics";
import type { UserConfig } from "./user";
import type { Skill } from "./skill";
import type { Tool } from "./tool";
import type { MCPServer } from "./mcp";

export interface AgentFullConfig {
  agentId: string;
  ethics: EthicsConfig;
  user: UserConfig;
  skills: Skill[];
  tools: Tool[];
  mcpServers: MCPServer[];
}

export type ConfigSection = "ethics" | "user" | "skills" | "tools" | "mcp";

export interface ConfigValidationError {
  section: ConfigSection;
  field: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface ConfigSnapshot {
  id: string;
  agentId: string;
  config: AgentFullConfig;
  label: string;
  createdAt: string;
}

export type SaveStatus = "saved" | "pending" | "saving" | "error";
