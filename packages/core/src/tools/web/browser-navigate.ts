/**
 * browser_navigate - Navigate to URL and get rendered content
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Supports full JavaScript rendering.
 *
 * @category web
 * @seedId browser_navigate
 * @spanish navegar a url, abrir página, sitio web
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-navigate");

export const browserNavigateTool: Tool = {
  name: "browser_navigate",
  description: "Navigate browser to URL, get rendered page content (supports JS). Spanish: navegar a url, abrir página, sitio web",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to navigate to",
      },
      waitFor: {
        type: "string",
        description: "CSS selector to wait for before returning (optional)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["url"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string;
    const waitFor = params.waitFor as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Navigating: ${url}${waitFor ? ` (waiting for: ${waitFor})` : ""}`);

    let browser: import("puppeteer-core").Browser | null = null;
    let page: import("puppeteer-core").Page | null = null;

    try {
      browser = await browserService.getConnection();
      if (!browser) {
        throw new Error("Failed to get browser connection");
      }

      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();

      // Set timeout
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      // Navigate to URL
      const response = await page.goto(url, {
        waitUntil: "networkidle2",
        timeout,
      });

      if (!response) {
        throw new Error("Navigation failed - no response");
      }

      // Wait for specific selector if provided
      if (waitFor) {
        try {
          await page.waitForSelector(waitFor, { timeout });
        } catch (e) {
          log.warn(`Selector "${waitFor}" not found within timeout`);
        }
      }

      // Get final URL (after redirects)
      const finalUrl = page.url();

      // Extract content - remove scripts and styles, keep text
      const content = await page.evaluate(() => {
        // Remove script and style elements
        document.querySelectorAll("script, style, noscript, meta, link, iframe").forEach(el => el.remove());
        
        // Get text content
        let text = document.body.innerText || document.documentElement.innerText || "";
        
        // Clean up whitespace
        text = text.replace(/\s+/g, " ").trim();
        
        // Limit to 50000 characters
        return text.slice(0, 50000);
      });

      log.info(`Navigation successful: ${finalUrl} (${content.length} chars)`);

      return {
        ok: true,
        url,
        finalUrl,
        content,
        length: content.length,
        statusCode: response.status(),
      };
    } catch (error) {
      log.error(`Navigation failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to navigate: ${(error as Error).message}`,
      };
    } finally {
      // Note: We don't close the page/browser as Lightpanda manages the session
      // The connection is pooled and reused
    }
  },
};
