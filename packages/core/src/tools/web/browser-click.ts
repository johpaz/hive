/**
 * browser_click - Click on a web page element
 *
 * @category web
 * @seedId browser_click
 * @spanish hacer clic, botón, enlace, interactuar
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-click");

export const browserClickTool: Tool = {
  name: "browser_click",
  description: "Click on a web page element. Spanish: hacer clic, botón, enlace, interactuar",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to click",
      },
      url: {
        type: "string",
        description: "URL to navigate to before clicking (optional)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["selector"],
  },
  execute: async (params: Record<string, unknown>) => {
    const selector = params.selector as string;
    const url = params.url as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;

    const browserService = getBrowserService();
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome/Chromium.",
      };
    }

    log.info(`Clicking: ${selector}${url ? ` on ${url}` : ""}`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome/Chromium." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      // click(selector) already waits for element actionability
      await view.click(selector, { timeout });

      const currentUrl = view.url;
      log.info(`Click successful: ${selector} on ${currentUrl}`);

      return {
        ok: true,
        message: `Successfully clicked element: ${selector}`,
        selector,
        url: currentUrl,
      };
    } catch (error) {
      log.error(`Click failed: ${(error as Error).message}`);
      return { ok: false, error: `Failed to click: ${(error as Error).message}` };
    }
  },
};
