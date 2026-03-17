/**
 * Hive SDK - Types Module
 *
 * Exposes all TypeScript types from the Hive system.
 * Use this for complete type support when building on Hive.
 *
 * @example
 * import type { StoredMessage, LLMMessage } from "@johpaz/hive-sdk/types";
 */

export type {
  AgentDBRecord,
  AgentServiceConfig,
} from "@johpaz/hive/agent/service";

export type {
  AgentLoopOptions,
  StepEvent,
  StreamChunk,
} from "@johpaz/hive/agent/agent-loop";

export type {
  LLMMessage,
  LLMResponse,
  LLMCallOptions,
  LLMToolCall,
} from "@johpaz/hive/agent/llm-client";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
} from "@johpaz/hive/channels/base";

export type {
  MCPTool,
  MCPResource,
  MCPPrompt,
} from "@johpaz/hive/mcp/manager";

export type {
  MCPConfig,
  MCPServerConfig,
} from "@johpaz/hive/mcp/config";

export type {
  Skill,
  SkillMetadata,
  SkillStep,
  SkillExample,
  OutputFormat,
  SkillsConfig,
} from "@johpaz/hive/skills/loader";

export type {
  StoredMessage,
} from "@johpaz/hive/agent/conversation-store";
