/**
 * browser_type - Type text into a form field
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
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome/Chromium.",
      };
    }

    log.info(`Typing into: ${selector}${url ? ` on ${url}` : ""} (${text.length} chars)`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome/Chromium." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      // click(selector) waits for actionability then focuses the element
      await view.click(selector, { timeout });

      if (clear) {
        // Ctrl+A → Backspace to clear existing content
        await view.press("a", { modifiers: ["Control"] });
        await view.press("Backspace");
      }

      await view.type(text);

      const currentUrl = view.url;
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
