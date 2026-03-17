/**
 * Hive SDK - Agents Module
 *
 * Exposes agent execution, context compilation, and agent loop functionality.
 *
 * @example
 * import { runAgent, AgentService, compileContext } from "@johpaz/hive-sdk/agents";
 *
 * // Run an agent with a message
 * const response = await runAgent({
 *   agentId: "main",
 *   message: "Hello, agent!",
 *   threadId: "thread-123"
 * });
 */

export { AgentService, getAgentService, createAgentService } from "@johpaz/hive/agent/service";

export type { AgentServiceConfig, AgentDBRecord } from "@johpaz/hive/agent/service";

export { runAgent, runAgentIsolated, rebuildAgentLoop, getAgentLoop } from "@johpaz/hive/agent/agent-loop";

export type { AgentLoopOptions, StepEvent, StreamChunk } from "@johpaz/hive/agent/agent-loop";

export { compileContext } from "@johpaz/hive/agent/context-compiler";

export { buildSystemPromptWithProjects } from "@johpaz/hive/agent/prompt-builder";

export { addMessage, getHistory, getRecentMessages, getMessageCount, getTotalTokens, getMessagesAfter } from "@johpaz/hive/agent/conversation-store";

export type { StoredMessage } from "@johpaz/hive/agent/conversation-store";

export { selectTools } from "@johpaz/hive/agent/tool-selector";

export { selectSkills } from "@johpaz/hive/agent/skill-selector";

export { selectPlaybookRules } from "@johpaz/hive/agent/playbook-selector";

export { callLLM, resolveProviderConfig } from "@johpaz/hive/agent/llm-client";

export type { LLMMessage, LLMResponse, LLMCallOptions, LLMToolCall } from "@johpaz/hive/agent/llm-client";

export { resolveAgentId, resolveUserId } from "@johpaz/hive/storage/onboarding";

export {
  memoryWriteTool,
  memoryReadTool,
  memoryListTool,
  memorySearchTool,
  memoryDeleteTool,
  agentCreateTool,
  agentFindTool,
  agentArchiveTool,
  taskDelegateTool,
  taskDelegateCodeTool,
  taskStatusTool,
  busPublishTool,
  busReadTool,
  projectUpdatesTool,
  createTools as createAgentTools,
} from "@johpaz/hive/tools/agents/index";
