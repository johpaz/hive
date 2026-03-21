/**
 * Hive SDK - Tools Module
 *
 * Exposes the tool registry, all seed tools, and tool creation utilities.
 *
 * @example
 * import { createAllTools, ToolRegistry } from "@johpaz/hiveAgents-sdk/tools";
 *
 * // Create all 52 tools
 * const tools = createAllTools(config);
 *
 * // Or by category
 * const fsTools = createToolsByCategory("filesystem", config);
 */

export {
  createAllTools,
  createToolsByCategory,
  type Tool,
  type ToolResult,
} from "@johpaz/hiveAgents/tools/index";

export {
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
} from "@johpaz/hiveAgents/tools/filesystem/index";

export {
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
} from "@johpaz/hiveAgents/tools/web/index";

export {
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
} from "@johpaz/hiveAgents/tools/projects/index";

export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  initCronScheduler,
  resolveBestChannel,
} from "@johpaz/hiveAgents/tools/cron/index";

export { cliExecTool } from "@johpaz/hiveAgents/tools/cli/index";

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
} from "@johpaz/hiveAgents/tools/agents/index";

export {
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
} from "@johpaz/hiveAgents/tools/canvas/index";

export {
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
} from "@johpaz/hiveAgents/tools/codebridge/index";

export {
  voiceTranscribeTool,
  voiceSpeakTool,
} from "@johpaz/hiveAgents/tools/voice/index";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "@johpaz/hiveAgents/tools/core/index";
