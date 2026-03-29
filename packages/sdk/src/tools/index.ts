/**
 * Hive SDK - Tools Module
 *
 * Exposes the tool registry, all seed tools, and tool creation utilities.
 *
 * @example
 * import { createAllTools, ToolRegistry } from "@johpaz/hive-agents-sdk/tools";
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
} from "@johpaz/hive-agents-core/tools";

export {
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
} from "@johpaz/hive-agents-core/tools/filesystem";

export {
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
} from "@johpaz/hive-agents-core/tools/web";

export {
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
} from "@johpaz/hive-agents-core/tools/projects";

export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  initCronScheduler,
  resolveBestChannel,
} from "@johpaz/hive-agents-core/tools/cron";

export { cliExecTool } from "@johpaz/hive-agents-core/tools/cli";

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
} from "@johpaz/hive-agents-core/tools/agents";

export {
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
} from "@johpaz/hive-agents-core/tools/canvas";

export {
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
  codebridgeFeedbackTool,
} from "@johpaz/hive-agents-core/tools/codebridge";

export {
  voiceTranscribeTool,
  voiceSpeakTool,
} from "@johpaz/hive-agents-core/tools/voice";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "@johpaz/hive-agents-core/tools/core";
