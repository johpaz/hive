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

// Agents
export {
  AgentService,
  getAgentService,
  createAgentService,
  runAgent,
  runAgentIsolated,
  rebuildAgentLoop,
  getAgentLoop,
  compileContext,
  buildSystemPromptWithProjects,
  addMessage,
  getHistory,
  getRecentMessages,
  getMessageCount,
  getTotalTokens,
  getMessagesAfter,
  selectTools,
  selectSkills,
  selectPlaybookRules,
  callLLM,
  resolveProviderConfig,
  resolveAgentId,
  resolveUserId,
  memoryWriteTool as agentMemoryWriteTool,
  memoryReadTool as agentMemoryReadTool,
  memoryListTool as agentMemoryListTool,
  memorySearchTool as agentMemorySearchTool,
  memoryDeleteTool as agentMemoryDeleteTool,
  agentCreateTool,
  agentFindTool,
  agentArchiveTool,
  taskDelegateTool,
  taskDelegateCodeTool,
  taskStatusTool,
  busPublishTool,
  busReadTool,
  projectUpdatesTool,
  createAgentTools,
} from "./agents/index";

export type {
  AgentServiceConfig,
  AgentDBRecord,
  AgentLoopOptions,
  StepEvent,
  StreamChunk,
  LLMMessage,
  LLMResponse,
  LLMCallOptions,
  LLMToolCall,
  StoredMessage,
} from "./agents/index";

// Tools
export {
  createAllTools,
  createToolsByCategory,
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
  cronCreateTool,
  cronListTool,
  cronPauseTool,
  cronResumeTool,
  cronDeleteTool,
  cronTriggerTool,
  cronHistoryTool,
  resolveBestChannel,
  cliExecTool,
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
  codebridgeFeedbackTool,
  voiceTranscribeTool,
  voiceSpeakTool,
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "./tools/index";

export type { Tool, ToolResult } from "./tools/index";

// Skills
export { SkillLoader, createSkillLoader } from "./skills/index";

export type {
  SkillsConfig,
  Config,
  SkillStep,
  OutputFormat,
  SkillExample,
  SkillMetadata,
  Skill,
} from "./skills/index";

// MCP
export { MCPClientManager, logger } from "./mcp/index";

export type {
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPConfig,
  MCPServerConfig,
} from "./mcp/index";

// Channels
export {
  ChannelManager,
  TelegramChannel,
  DiscordChannel,
  WhatsAppChannel,
  SlackChannel,
  WebChatChannel,
} from "./channels/index";

export type {
  OutboundMessage,
  IncomingMessage,
  ChannelConfig,
  IChannel,
  MessageHandler,
  TelegramConfig,
  DiscordConfig,
  WhatsAppConfig,
  WhatsAppConnectionState,
  SlackConfig,
  SlackConnectionState,
  WebChatConfig,
} from "./channels/index";

// Cron
export {
  cronCreateTool,
  cronListTool,
  cronUpdateTool,
  cronPauseTool,
  cronResumeTool,
  cronDeleteTool,
  cronTriggerTool,
  cronHistoryTool,
  createCronTools,
  setSchedulerInstance,
} from "./cron/index";

// Ethics
export { getAllEthics, activateEthics } from "./ethics/index";

// Database
export {
  getDb,
  initializeDatabase,
  getDbPathLazy,
  dbService,
  seedAllData,
  seedToolsAndSkills,
  getAllElements,
  getActiveElements,
  encrypt,
  decrypt,
  encryptApiKey,
  decryptApiKey,
  encryptConfig,
  decryptConfig,
  hashPassword,
  verifyPassword,
  maskApiKey,
  getAllProviders,
  getAllModels,
  getAllCodeBridge,
  getAllSkills,
  getAllDbTools,
  getAllMcpServers,
  getAllChannels,
  getActiveTools,
  getUserAgents,
  getSingleUserId,
  getCoordinatorAgentId,
  getDefaultAgentId,
  getAgentConfig,
} from "./database/index";

export type {
  SCHEMA,
  PROJECTS_SCHEMA,
  CONTEXT_ENGINE_SCHEMA,
} from "./database/index";

// Types
export type {
  AgentDBRecord as AgentDBRecordType,
  AgentServiceConfig as AgentServiceConfigType,
  AgentLoopOptions as AgentLoopOptionsType,
  StepEvent as StepEventType,
  StreamChunk as StreamChunkType,
  LLMMessage as LLMMessageType,
  LLMResponse as LLMResponseType,
  LLMCallOptions as LLMCallOptionsType,
  LLMToolCall as LLMToolCallType,
  OutboundMessage as OutboundMessageType,
  IncomingMessage as IncomingMessageType,
  ChannelConfig as ChannelConfigType,
  IChannel as IChannelType,
  MCPTool as MCPToolType,
  MCPResource as MCPResourceType,
  MCPPrompt as MCPPromptType,
  MCPConfig as MCPConfigType,
  MCPServerConfig as MCPServerConfigType,
  Skill as SkillType,
  SkillMetadata as SkillMetadataType,
  SkillStep as SkillStepType,
  SkillExample as SkillExampleType,
  OutputFormat as OutputFormatType,
  SkillsConfig as SkillsConfigType,
  StoredMessage as StoredMessageType,
} from "./types/index";

export const SDK_VERSION = "1.0.0";
