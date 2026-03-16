/**
 * browser_screenshot - Take screenshot of current browser page
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Returns screenshot as base64 PNG.
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
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Taking screenshot${url ? ` of: ${url}` : ""}${selector ? ` (element: ${selector})` : ""}`);

    let browser: import("puppeteer-core").Browser | null = null;
    let page: import("puppeteer-core").Page | null = null;

    try {
      browser = await browserService.getConnection();
      if (!browser) {
        throw new Error("Failed to get browser connection");
      }

      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

      // Navigate to URL if provided
      if (url) {
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      }

      // Take screenshot
      const screenshotOptions: import("puppeteer-core").ScreenshotOptions = {
        encoding: "base64",
        fullPage,
        type: "png",
      };

      let screenshot: string;
      
      if (selector) {
        // Screenshot of specific element
        const element = await page.$(selector);
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }
        const screenshotData = await element.screenshot(screenshotOptions);
        screenshot = Buffer.from(screenshotData as Uint8Array).toString("base64");
      } else {
        // Full page or viewport screenshot
        const screenshotData = await page.screenshot(screenshotOptions);
        screenshot = Buffer.from(screenshotData as Uint8Array).toString("base64");
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
      return {
        ok: false,
        error: `Failed to take screenshot: ${(error as Error).message}`,
      };
    }
  },
};
