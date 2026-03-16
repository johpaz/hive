/**
 * browser_screenshot - Take screenshot of current browser page
 *
 * Uses Puppeteer + Chromium. Returns screenshot as base64 PNG.
 *
 * @category web
 * @seedId browser_screenshot
 * @spanish captura de pantalla, screenshot, imagen de página
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

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
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Chromium not started");
      return {
        ok: false,
        error: "Browser automation not available. Chromium must be running.",
      };
    }

    log.info(`Taking screenshot${url ? ` of: ${url}` : ""}${selector ? ` (element: ${selector})` : ""}`);

    try {
      const page = await browserService.getPage();
      if (!page) {
        throw new Error("Failed to get browser page");
      }

      if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      }

      let screenshot: string;

      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }
        const data = await element.screenshot({ encoding: "base64", type: "png" });
        screenshot = data as string;
      } else {
        const data = await page.screenshot({ encoding: "base64", fullPage, type: "png" });
        screenshot = data as string;
      }

      const currentUrl = page.url();
      const viewport = await page.viewport();

      log.info(`Screenshot captured: ${currentUrl} (${screenshot.length} base64 chars)`);

      return {
        ok: true,
        url: currentUrl,
        screenshot,
        format: "png",
        encoding: "base64",
        fullPage,
        selector,
        viewport: viewport ? { width: viewport.width, height: viewport.height } : null,
      };
    } catch (error) {
      log.error(`Screenshot failed: ${(error as Error).message}`);
      return { ok: false, error: `Failed to take screenshot: ${(error as Error).message}` };
    }
  },
};
