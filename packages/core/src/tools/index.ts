/**
 * Tools Registry - Exports all 52 tools
 * 
 * Import this to get all tools:
 * import { createAllTools } from "./tools";
 */

import type { Tool } from "./types.ts";
import type { Config } from "../config/loader.ts";

// Filesystem (7)
import * as filesystem from "./filesystem/index.ts";

// Web (6)
import * as web from "./web/index.ts";

// Projects (8)
import * as projects from "./projects/index.ts";

// Cron (4)
import * as cron from "./cron/index.ts";

// CLI (1)
import * as cli from "./cli/index.ts";

// Agents (14)
import * as agents from "./agents/index.ts";

// Canvas (7)
import * as canvas from "./canvas/index.ts";

// Codebridge (3)
import * as codebridge from "./codebridge/index.ts";

// Voice (2)
import * as voice from "./voice/index.ts";

// Core (4)
import * as core from "./core/index.ts";

/**
 * Creates all 52 tools with proper configuration
 */
export function createAllTools(config: Config): Tool[] {
  return [
    // FILESYSTEM (7)
    ...filesystem.createTools(),
    
    // WEB (6)
    ...web.createTools(),
    
    // PROJECTS (8)
    ...projects.createTools(),
    
    // CRON (4)
    ...cron.createTools(),
    
    // CLI (1)
    ...cli.createTools(),
    
    // AGENTS (14)
    ...agents.createTools(),
    
    // CANVAS (7)
    ...canvas.createTools(),
    
    // CODEBRIDGE (3)
    ...codebridge.createTools(),
    
    // VOICE (2)
    ...voice.createTools(),
    
    // CORE (4)
    ...core.createTools(),
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
    case "projects":
      return projects.createTools();
    case "cron":
      return cron.createTools();
    case "cli":
      return cli.createTools();
    case "agents":
      return agents.createTools();
    case "canvas":
      return canvas.createTools();
    case "codebridge":
      return codebridge.createTools();
    case "voice":
      return voice.createTools();
    case "core":
      return core.createTools();
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
} from "./web/index.ts";

export {
  projectCreateTool,
  projectListTool,
  projectUpdateTool,
  projectDoneTool,
  projectFailTool,
  taskCreateTool,
  taskUpdateTool,
  taskEvaluateTool,
} from "./projects/index.ts";

export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  initCronScheduler,
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
  taskDelegateCodeTool,
  taskStatusTool,
  busPublishTool,
  busReadTool,
  projectUpdatesTool,
} from "./agents/index.ts";

export {
  canvasRenderTool,
  canvasAskTool,
  canvasConfirmTool,
  canvasShowCardTool,
  canvasShowProgressTool,
  canvasShowListTool,
  canvasClearTool,
} from "./canvas/index.ts";

export {
  codebridgeLaunchTool,
  codebridgeStatusTool,
  codebridgeCancelTool,
} from "./codebridge/index.ts";

export {
  voiceTranscribeTool,
  voiceSpeakTool,
} from "./voice/index.ts";

export {
  searchKnowledgeTool,
  notifyTool,
  saveNoteTool,
  reportProgressTool,
} from "./core/index.ts";
