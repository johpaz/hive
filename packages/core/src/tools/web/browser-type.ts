/**
 * browser_type - Type text into a form field
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Supports typing into input, textarea, and contenteditable elements.
 *
 * @category web
 * @seedId browser_type
 * @spanish escribir formulario, tipear, campo de texto, input
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-type");

export const browserTypeTool: Tool = {
  name: "browser_type",
  description: "Type text into a form field in the browser. Spanish: escribir formulario, tipear, campo de texto, input",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the input field",
      },
      text: {
        type: "string",
        description: "Text to type into the field",
      },
      url: {
        type: "string",
        description: "URL to navigate to before typing (optional)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
      clear: {
        type: "boolean",
        description: "Clear existing text before typing (default: true)",
      },
    },
    required: ["selector", "text"],
  },
  execute: async (params: Record<string, unknown>) => {
    const selector = params.selector as string;
    const text = params.text as string;
    const url = params.url as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;
    const clear = (params.clear as boolean) ?? true;

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Typing into: ${selector}${url ? ` on ${url}` : ""} (${text.length} chars)`);

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

      // Wait for element to be visible and enabled
      await page.waitForSelector(selector, {
        timeout,
      });

      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Clear existing text if requested
      if (clear) {
        await element.click();
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
      }

      // Type the text
      await element.type(text, { delay: 10 });

      const currentUrl = page.url();

      log.info(`Type successful: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}" into ${selector}`);

      return {
        ok: true,
        message: `Successfully typed text into element: ${selector}`,
        selector,
        text,
        url: currentUrl,
        length: text.length,
      };
    } catch (error) {
      log.error(`Type failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to type: ${(error as Error).message}`,
      };
    }
  },
};
