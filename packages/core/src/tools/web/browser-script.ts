/**
 * browser_script - Execute arbitrary JavaScript in page context
 * 
 * Uses Puppeteer Core to connect to Lightpanda via CDP.
 * Runs JavaScript code in the browser context and returns the result.
 *
 * @category web
 * @seedId browser_script
 * @spanish ejecutar javascript, script, código, función, evaluar
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";

const log = logger.child("browser-script");

export const browserScriptTool: Tool = {
  name: "browser_script",
  description: "Execute arbitrary JavaScript in the browser page context and get the result. Spanish: ejecutar javascript, script, código, función, evaluar",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to before executing (optional)",
      },
      script: {
        type: "string",
        description: "JavaScript code to execute in page context",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
      awaitPromise: {
        type: "boolean",
        description: "Wait for promise resolution if script returns one (default: true)",
      },
    },
    required: ["script"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string | undefined;
    const script = params.script as string;
    const timeout = (params.timeout as number) ?? 30000;
    const awaitPromise = (params.awaitPromise as boolean) ?? true;

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available - Lightpanda not connected");
      return {
        ok: false,
        error: "Browser automation not available. Lightpanda must be running. See: https://github.com/lightpanda-org/lightpanda",
      };
    }

    log.info(`Executing script${url ? ` on ${url}` : ""} (${script.length} chars)`);

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

      // Execute the script
      const result = await page.evaluate((scriptCode: string) => {
        // Execute in async context to support both sync and async scripts
        return (async () => {
          try {
            // Use eval to execute the script code
            // eslint-disable-next-line no-eval
            const result = eval(scriptCode);
            // If it's a promise and awaitPromise is true, wait for it
            if (result instanceof Promise) {
              return await result;
            }
            return result;
          } catch (e) {
            throw new Error(`Script execution error: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      }, script);

      const currentUrl = page.url();

      log.info(`Script executed successfully on ${currentUrl}`);

      // Serialize result to JSON-safe format
      let serializedResult;
      try {
        serializedResult = JSON.parse(JSON.stringify(result));
      } catch {
        // If result is not JSON-serializable, convert to string
        serializedResult = String(result);
      }

      return {
        ok: true,
        url: currentUrl,
        result: serializedResult,
        scriptLength: script.length,
      };
    } catch (error) {
      log.error(`Script execution failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to execute script: ${(error as Error).message}`,
      };
    }
  },
};
