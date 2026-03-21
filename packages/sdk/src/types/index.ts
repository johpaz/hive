/**
 * Hive SDK - Types Module
 *
 * Exposes all TypeScript types from the Hive system.
 * Use this for complete type support when building on Hive.
 *
 * @example
 * import type { StoredMessage, LLMMessage } from "@johpaz/hive-agents-sdk/types";
 */

export type {
  AgentDBRecord,
  AgentServiceConfig,
} from "@johpaz/hive-agents/agent/service";

export type {
  AgentLoopOptions,
  StepEvent,
  StreamChunk,
} from "@johpaz/hive-agents/agent/agent-loop";

export type {
  LLMMessage,
  LLMResponse,
  LLMCallOptions,
  LLMToolCall,
} from "@johpaz/hive-agents/agent/llm-client";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
} from "@johpaz/hive-agents/channels/base";

export type {
  MCPTool,
  MCPResource,
  MCPPrompt,
} from "@johpaz/hive-agents/mcp/manager";

export type {
  MCPConfig,
  MCPServerConfig,
} from "@johpaz/hive-agents/mcp/config";

export type {
  Skill,
  SkillMetadata,
  SkillStep,
  SkillExample,
  OutputFormat,
  SkillsConfig,
} from "@johpaz/hive-agents/skills/loader";

export type {
  StoredMessage,
} from "@johpaz/hive-agents/agent/conversation-store";
