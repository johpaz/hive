/**
 * browser_click - Click on a web page element
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Supports CSS selectors and XPath.
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
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Clicking: ${selector}${url ? ` on ${url}` : ""}`);

    let browser: import("puppeteer-core").Browser | null = null;
    let page: import("puppeteer-core").Page | null = null;

    try {
      browser = await browserService.getConnection();
      if (!browser) {
        throw new Error("Failed to get browser connection");
      }

      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

      page.setDefaultTimeout(timeout);

      // Navigate to URL if provided
      if (url) {
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout,
        });
      }

      // Wait for element to be visible
      await page.waitForSelector(selector, {
        timeout,
      });

      // Click the element
      await page.click(selector);

      const currentUrl = page.url();

      log.info(`Click successful: ${selector} on ${currentUrl}`);

      return {
        ok: true,
        message: `Successfully clicked element: ${selector}`,
        selector,
        url: currentUrl,
      };
    } catch (error) {
      log.error(`Click failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to click: ${(error as Error).message}`,
      };
    }
  },
};
