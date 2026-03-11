/**
 * Web Tools - 6 tools
 * 
 * @category web
 */

import type { Tool } from "../types.ts";
import { webSearchTool } from "./web-search.ts";
import { webFetchTool } from "./web-fetch.ts";
import { browserNavigateTool } from "./browser-navigate.ts";
import { browserScreenshotTool } from "./browser-screenshot.ts";
import { browserClickTool } from "./browser-click.ts";
import { browserTypeTool } from "./browser-type.ts";

export function createTools(): Tool[] {
  return [
    webSearchTool,
    webFetchTool,
    browserNavigateTool,
    browserScreenshotTool,
    browserClickTool,
    browserTypeTool,
  ];
}

export * from "./web-search.ts";
export * from "./web-fetch.ts";
export * from "./browser-navigate.ts";
export * from "./browser-screenshot.ts";
export * from "./browser-click.ts";
export * from "./browser-type.ts";
