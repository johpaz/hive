/**
 * browser_navigate - Navigate to URL and get rendered content
 *
 * @category web
 * @seedId browser_navigate
 * @spanish navegar a url, abrir página, sitio web
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService, waitForSelector } from "./browser-service.ts";

const log = logger.child("browser-navigate");

export const browserNavigateTool: Tool = {
  name: "browser_navigate",
  description: "Navigate browser to URL, get rendered page content (supports JS). Returns compact accessibility tree with element refs (@e1, @e2) for interaction. Spanish: navegar a url, abrir página, sitio web",
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
      mode: {
        type: "string",
        enum: ["snapshot", "text"],
        description: "Content mode: 'snapshot' (compact accessibility tree with refs, default) or 'text' (full innerText). Use 'text' only if you need all readable text.",
      },
    },
    required: ["url"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string;
    const waitFor = params.waitFor as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;
    const mode = (params.mode as string) ?? "snapshot";

    const browserService = getBrowserService();
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install agent-browser.",
      };
    }

    log.info(`Navigating: ${url}${waitFor ? ` (waiting for: ${waitFor})` : ""} [mode=${mode}]`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install agent-browser." };

      await view.navigate(url);

      // Esperar a que JS termine de ejecutar
      await Bun.sleep(500);

      if (waitFor) {
        try {
          await waitForSelector(view, waitFor, timeout);
        } catch {
          log.warn(`Selector "${waitFor}" not found within timeout`);
        }
      }

      const finalUrl = view.url;
      let content: string;
      let contentType: string;

      if (mode === "text") {
        // Full innerText (legacy mode, heavy)
        content = await view.evaluate(`
          (() => {
            try {
              document.querySelectorAll("script, style, noscript, meta, link, iframe").forEach(el => el.remove());
              let text = document.body?.innerText || document.documentElement?.innerText || "";
              text = text.replace(/\\s+/g, " ").trim();
              return text.slice(0, 50000);
            } catch (e) {
              return "Error extracting content: " + e.message;
            }
          })()
        `) as string;
        contentType = "text";
      } else {
        // Default: compact accessibility snapshot with refs
        content = await view.snapshot({ compact: true, depth: 3 });
        contentType = "snapshot";
      }

      log.info(`Navigation successful: ${finalUrl} (${content.length} chars, ${contentType})`);

      return {
        ok: true,
        url,
        finalUrl,
        content,
        contentType,
        length: content.length,
      };
    } catch (error) {
      const msg = (error as Error).message;

      if (msg.includes("timeout")) {
        log.error(`Navigation timeout: ${url}`);
        return { ok: false, error: `Timeout (${timeout}ms): la página tardó demasiado.` };
      }

      log.error(`Navigation failed: ${msg}`);
      return { ok: false, error: `Failed to navigate: ${msg}` };
    }
  },
};
