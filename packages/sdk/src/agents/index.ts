/**
 * Hive SDK - Agents Module
 *
 * Exposes agent execution, context compilation, and agent loop functionality.
 *
 * @example
 * import { runAgent, AgentService, compileContext } from "@johpaz/hiveAgents-sdk/agents";
 *
 * // Run an agent with a message
 * const response = await runAgent({
 *   agentId: "main",
 *   message: "Hello, agent!",
 *   threadId: "thread-123"
 * });
 */

export { AgentService, getAgentService, createAgentService } from "@johpaz/hiveAgents/agent/service";

export type { AgentServiceConfig, AgentDBRecord } from "@johpaz/hiveAgents/agent/service";

export { runAgent, runAgentIsolated, rebuildAgentLoop, getAgentLoop } from "@johpaz/hiveAgents/agent/agent-loop";

export type { AgentLoopOptions, StepEvent, StreamChunk } from "@johpaz/hiveAgents/agent/agent-loop";

export { compileContext } from "@johpaz/hiveAgents/agent/context-compiler";

export { buildSystemPromptWithProjects } from "@johpaz/hiveAgents/agent/prompt-builder";

export { addMessage, getHistory, getRecentMessages, getMessageCount, getTotalTokens, getMessagesAfter } from "@johpaz/hiveAgents/agent/conversation-store";

export type { StoredMessage } from "@johpaz/hiveAgents/agent/conversation-store";

export { selectTools } from "@johpaz/hiveAgents/agent/tool-selector";

export { selectSkills } from "@johpaz/hiveAgents/agent/skill-selector";

export { selectPlaybookRules } from "@johpaz/hiveAgents/agent/playbook-selector";

export { callLLM, resolveProviderConfig } from "@johpaz/hiveAgents/agent/llm-client";

export type { LLMMessage, LLMResponse, LLMCallOptions, LLMToolCall } from "@johpaz/hiveAgents/agent/llm-client";

export { resolveAgentId, resolveUserId } from "@johpaz/hiveAgents/storage/onboarding";

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
} from "@johpaz/hiveAgents/tools/agents/index";
