/**
 * Tools Registry
 *
 * Import this to get all tools:
 * import { createAllTools } from "./tools";
 */

import type { Tool } from "./types.ts";
import type { Config } from "../config/loader.ts";

// Filesystem (7)
import * as filesystem from "./filesystem/index.ts";

// Web (10)
import * as web from "./web/index.ts";

// Cron (8) - Croner-based scheduler tools
import * as cron from "./cron/index.ts";

// CLI (1)
import * as cli from "./cli/index.ts";

// Agents (15)
import * as agents from "./agents/index.ts";

// A2UI (4)
import * as a2ui from "./a2ui/index.ts";

// Core (4)
import * as core from "./core/index.ts";

// Office (8)
import * as office from "./office/index.ts";

// API (1) - HTTP client for REST APIs
import * as api from "./api/index.ts";

/**
 * Creates all tools with proper configuration
 */
export function createAllTools(config: Config): Tool[] {
  return [
    // FILESYSTEM (7)
    ...filesystem.createTools(),

    // WEB (10)
    ...web.createTools(),

    // CRON (8)
    ...cron.createTools(),

    // CLI (1)
    ...cli.createTools(),

    // AGENTS (14)
    ...agents.createTools(),

    // A2UI (4)
    ...a2ui.createTools(config),

    // CORE (4)
    ...core.createTools(),

    // OFFICE (8)
    ...office.createTools(),

    // API (1)
    ...api.createTools(),

  ];
}

/**
 * Creates tools by category (for selective loading)
 */
export function createToolsByCategory(category: string, config: Config): Tool[] {
  switch (category) {
    case "filesystem":
      return filesystem.createTools();
    case "web":
      return web.createTools();
    case "cron":
      return cron.createTools();
    case "cli":
      return cli.createTools();
    case "agents":
      return agents.createTools();
    case "a2ui":
      return a2ui.createTools(config);
    case "core":
      return core.createTools();
    case "office":
      return office.createTools();
    case "api":
      return api.createTools();
    default:
      return [];
  }
}

// Export types
export * from "./types.ts";

// Export tools by category (avoiding createTools name collisions)
// Use category-specific imports or createAllTools/createToolsByCategory
export {
  fsEditTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsListTool,
  fsGlobTool,
  fsExistsTool,
} from "./filesystem/index.ts";

export {
  webSearchTool,
  webFetchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserExtractTool,
  browserScriptTool,
  browserWaitTool,
  artifactInspectTool,
} from "./web/index.ts";

export {
  cronCreateTool,
  cronListTool,
  cronUpdateTool,
  cronPauseTool,
  cronResumeTool,
  cronDeleteTool,
  cronTriggerTool,
  cronHistoryTool,
  setSchedulerInstance,
  resolveBestChannel,
} from "./cron/index.ts";

export { cliExecTool } from "./cli/index.ts";

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
  taskReviseTool,
  taskListTool,
  taskStatusTool,
  busPublishTool,
  busReadTool,
} from "./agents/index.ts";

export {
  createA2UISurfaceTool,
  createA2UIUpdateComponentsTool,
  createA2UIUpdateDataModelTool,
  createA2UIDeleteSurfaceTool,
} from "./a2ui/index.ts";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "./core/index.ts";

export {
  officeLeerPdfTool,
  officeEscribirPdfTool,
  officeLeerDocxTool,
  officeEscribirDocxTool,
  officeLeerXlsxTool,
  officeEscribirXlsxTool,
  officeLeerPptxTool,
  officeEscribirPptxTool,
} from "./office/index.ts";

export {
  apiRequestTool,
} from "./api/index.ts";
