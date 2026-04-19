/**
 * browser_script - Execute arbitrary JavaScript in page context
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
    },
    required: ["script"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string | undefined;
    const script = params.script as string;
    const timeout = (params.timeout as number) ?? 30000;

    const browserService = getBrowserService();
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome/Chromium.",
      };
    }

    log.info(`Executing script${url ? ` on ${url}` : ""} (${script.length} chars)`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome/Chromium." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      const wrappedScript = `(async () => { try { return await (async () => { ${script} })(); } catch(e) { throw new Error('Script error: ' + e.message); } })()`;
      const result = await view.evaluate(wrappedScript);

      const currentUrl = view.url;
      log.info(`Script executed successfully on ${currentUrl}`);

      let serializedResult;
      try {
        serializedResult = JSON.parse(JSON.stringify(result));
      } catch {
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
