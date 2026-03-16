/**
 * browser_wait - Wait for element or condition on page
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Waits for CSS selector, XPath, or custom condition before continuing.
 *
 * @category web
 * @seedId browser_wait
 * @spanish esperar, wait, condición, elemento, selector
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-wait");

export const browserWaitTool: Tool = {
  name: "browser_wait",
  description: "Wait for an element to appear or condition to be met on the page. Spanish: esperar, wait, condición, elemento, selector",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to before waiting (optional)",
      },
      selector: {
        type: "string",
        description: "CSS selector to wait for (optional if condition provided)",
      },
      condition: {
        type: "string",
        description: "JavaScript expression to evaluate (optional if selector provided)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
      state: {
        type: "string",
        description: "Element state: visible, hidden, attached (default: visible)",
        enum: ["visible", "hidden", "attached"],
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string | undefined;
    const selector = params.selector as string | undefined;
    const condition = params.condition as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;
    const state = (params.state as string) ?? "visible";

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    if (!selector && !condition) {
      return {
        ok: false,
        error: "Either 'selector' or 'condition' must be provided",
      };
    }

    log.info(`Waiting${selector ? ` for selector: ${selector}` : ""}${condition ? ` for condition: ${condition}` : ""}${url ? ` on ${url}` : ""}`);

    try {
      const page = await browserService.getPage();
      if (!page) {
        throw new Error("Failed to get browser page");
      }

      page.setDefaultTimeout(timeout);

      // Navigate to URL if provided
      if (url) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout,
        });
      }

      const startTime = Date.now();

      let found = false;

      if (selector) {
        const isXPath = selector.startsWith("xpath:");
        const actualSelector = isXPath ? selector.slice(6) : selector;

        try {
          if (isXPath) {
            await page.waitForFunction(
              (xpath: string) => {
                const result = document.evaluate(
                  xpath, document, null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE, null
                );
                return result.singleNodeValue !== null;
              },
              { timeout },
              actualSelector
            );
          } else {
            await page.waitForSelector(actualSelector, { timeout });
          }
          found = true;
        } catch {
          log.warn(`Selector "${actualSelector}" not found within ${timeout}ms`);
        }
      }

      if (condition) {
        try {
          await page.waitForFunction(
            (conditionCode: string) => {
              // eslint-disable-next-line no-eval
              return eval(conditionCode);
            },
            { timeout },
            condition
          );
          found = true;
        } catch {
          log.warn(`Condition not met within ${timeout}ms`);
        }
      }

      const elapsed = Date.now() - startTime;
      const currentUrl = page.url();

      log.info(`Wait completed in ${elapsed}ms on ${currentUrl} (found=${found})`);

      return {
        ok: true,
        found,
        url: currentUrl,
        selector,
        condition,
        state,
        elapsedMs: elapsed,
      };
    } catch (error) {
      log.error(`Wait failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to wait: ${(error as Error).message}`,
      };
    }
  },
};
