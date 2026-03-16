/**
 * browser_extract - Extract data from web page using selectors
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Extracts text, links, attributes, or structured data using CSS selectors or XPath.
 *
 * @category web
 * @seedId browser_extract
 * @spanish extraer datos, obtener información, scraping, selectores
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-extract");

export const browserExtractTool: Tool = {
  name: "browser_extract",
  description: "Extract text, links, or structured data from page using CSS selectors or XPath. Spanish: extraer datos, obtener información, scraping, selectores",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to before extraction (optional)",
      },
      selector: {
        type: "string",
        description: "CSS selector or XPath (prefix with 'xpath:') to match elements",
      },
      attribute: {
        type: "string",
        description: "Attribute to extract (href, src, alt, text, innerHTML). Default: text",
      },
      all: {
        type: "boolean",
        description: "Extract all matches (default: true) or just first (false)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["selector"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string | undefined;
    const selector = params.selector as string;
    const attribute = (params.attribute as string) ?? "text";
    const all = (params.all as boolean) ?? true;
    const timeout = (params.timeout as number) ?? 30000;

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Extracting: ${selector}${url ? ` from ${url}` : ""}`);

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

      const isXPath = selector.startsWith("xpath:");
      const actualSelector = isXPath ? selector.slice(6) : selector;

      // Wait for element(s) to exist
      if (isXPath) {
        // XPath support via waitForFunction
        await page.waitForFunction(
          (xpath: string) => {
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            return result.singleNodeValue !== null;
          },
          { timeout },
          actualSelector
        );
      } else {
        await page.waitForSelector(actualSelector, { timeout });
      }

      // Extract data
      const extracted = await page.evaluate(
        ({ selector, isXPath, attribute, all }) => {
          const elements: Element[] = [];

          if (isXPath) {
            const result = document.evaluate(
              selector,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node.nodeType === Node.ELEMENT_NODE) {
                elements.push(node as Element);
              }
            }
          } else {
            const found = document.querySelectorAll(selector);
            found.forEach(el => elements.push(el));
          }

          if (!all && elements.length > 0) {
            elements.length = 1;
          }

          return elements.map(el => {
            if (attribute === "text") {
              return (el.textContent || "").trim();
            } else if (attribute === "innerHTML") {
              return el.innerHTML;
            } else {
              return el.getAttribute(attribute) || "";
            }
          });
        },
        { selector: actualSelector, isXPath, attribute, all }
      );

      const currentUrl = page.url();

      log.info(`Extracted ${extracted.length} element(s) from ${currentUrl}`);

      return {
        ok: true,
        url: currentUrl,
        selector,
        attribute,
        count: extracted.length,
        data: extracted,
      };
    } catch (error) {
      log.error(`Extraction failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to extract: ${(error as Error).message}`,
      };
    }
  },
};
