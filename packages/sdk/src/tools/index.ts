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
} from "@johpaz/hive/tools/index";

export {
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
} from "@johpaz/hive/tools/filesystem/index";

export {
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
} from "@johpaz/hive/tools/web/index";

export {
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
} from "@johpaz/hive/tools/projects/index";

export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  initCronScheduler,
  resolveBestChannel,
} from "@johpaz/hive/tools/cron/index";

export { cliExecTool } from "@johpaz/hive/tools/cli/index";

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
} from "@johpaz/hive/tools/agents/index";

export {
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
} from "@johpaz/hive/tools/canvas/index";

export {
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
} from "@johpaz/hive/tools/codebridge/index";

export {
  voiceTranscribeTool,
  voiceSpeakTool,
} from "@johpaz/hive/tools/voice/index";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "@johpaz/hive/tools/core/index";
