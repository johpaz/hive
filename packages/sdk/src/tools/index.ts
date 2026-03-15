/**
 * Hive SDK - Tools Module
 * 
 * Exposes the tool registry, all seed tools, and tool creation utilities.
 * 
 * @example
 * import { createAllTools, ToolRegistry } from "@johpaz/hive-sdk/tools";
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
} from "@johpaz/hive-core/tools/index";

export {
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
} from "@johpaz/hive-core/tools/filesystem/index";

export {
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
} from "@johpaz/hive-core/tools/web/index";

export {
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
} from "@johpaz/hive-core/tools/projects/index";

export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  initCronScheduler,
  resolveBestChannel,
} from "@johpaz/hive-core/tools/cron/index";

export { cliExecTool } from "@johpaz/hive-core/tools/cli/index";

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
} from "@johpaz/hive-core/tools/agents/index";

export {
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
} from "@johpaz/hive-core/tools/canvas/index";

export {
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
} from "@johpaz/hive-core/tools/codebridge/index";

export {
  voiceTranscribeTool,
  voiceSpeakTool,
} from "@johpaz/hive-core/tools/voice/index";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "@johpaz/hive-core/tools/core/index";
