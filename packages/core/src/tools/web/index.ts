/**
 * Web Tools - Browser automation + Web utilities
 * 
 * Browser tools use Puppeteer/Chromium (auto-managed).
 */

import type { Tool } from "../types.ts";
import { webSearchTool } from "./web-search.ts";
import { webFetchTool } from "./web-fetch.ts";
import { browserNavigateTool } from "./browser-navigate.ts";
import { browserScreenshotTool } from "./browser-screenshot.ts";
import { browserClickTool } from "./browser-click.ts";
import { browserTypeTool } from "./browser-type.ts";
import { browserExtractTool } from "./browser-extract.ts";
import { browserScriptTool } from "./browser-script.ts";
import { browserWaitTool } from "./browser-wait.ts";

export function createTools(): Tool[] {
  return [
    webSearchTool,
    webFetchTool,
    browserNavigateTool,
    browserScreenshotTool,
    browserClickTool,
    browserTypeTool,
    browserExtractTool,
    browserScriptTool,
    browserWaitTool,
  ];
}

export * from "./web-search.ts";
export * from "./web-fetch.ts";
export * from "./browser-navigate.ts";
export * from "./browser-screenshot.ts";
export * from "./browser-click.ts";
export * from "./browser-type.ts";
export * from "./browser-extract.ts";
export * from "./browser-script.ts";
export * from "./browser-wait.ts";
export * from "./browser-service.ts";
