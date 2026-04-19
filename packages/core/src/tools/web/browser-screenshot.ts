/**
 * browser_screenshot - Take screenshot of current browser page
 *
 * @category web
 * @seedId browser_screenshot
 * @spanish captura de pantalla, screenshot, imagen de página
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService, screenshotElement } from "./browser-service.ts";

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
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string | undefined;
    const fullPage = (params.fullPage as boolean) ?? false;
    const selector = params.selector as string | undefined;

    const browserService = getBrowserService();
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome/Chromium.",
      };
    }

    log.info(`Taking screenshot${url ? ` of: ${url}` : ""}${selector ? ` (element: ${selector})` : ""}`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome/Chromium." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      let screenshot: string;

      if (selector) {
        screenshot = await screenshotElement(view, selector);
      } else {
        screenshot = await view.screenshot({ encoding: "base64", format: "png" });
      }

      const currentUrl = view.url;
      log.info(`Screenshot captured: ${currentUrl} (${screenshot.length} base64 chars)`);

      return {
        ok: true,
        url: currentUrl,
        screenshot,
        format: "png",
        encoding: "base64",
        fullPage,
        selector,
        viewport: { width: 1280, height: 800 },
      };
    } catch (error) {
      log.error(`Screenshot failed: ${(error as Error).message}`);
      return { ok: false, error: `Failed to take screenshot: ${(error as Error).message}` };
    }
  },
};
