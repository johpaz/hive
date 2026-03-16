/**
 * browser_screenshot - NOT supported by Lightpanda
 *
 * Lightpanda does not support screenshot or PDF generation.
 * @see https://github.com/lightpanda-io/browser
 *
 * @category web
 * @seedId browser_screenshot
 * @spanish captura de pantalla, screenshot, imagen de página
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("browser-screenshot");

export const browserScreenshotTool: Tool = {
  name: "browser_screenshot",
  description: "Take screenshot of current browser page. Spanish: captura de pantalla, screenshot, imagen de página",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to before screenshot (optional)",
      },
      fullPage: {
        type: "boolean",
        description: "Capture full page height (default: false)",
      },
      selector: {
        type: "string",
        description: "CSS selector of specific element to screenshot (optional)",
      },
    },
    required: [],
  },
  execute: async (_params: Record<string, unknown>) => {
    log.warn("browser_screenshot called but Lightpanda does not support screenshots");
    return {
      ok: false,
      error: "Screenshots are not supported by Lightpanda. Use browser_navigate or browser_extract to get page content instead.",
    };
  },
};
