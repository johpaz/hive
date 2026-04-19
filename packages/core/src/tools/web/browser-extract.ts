/**
 * browser_extract - Extract data from web page using selectors
 *
 * @category web
 * @seedId browser_extract
 * @spanish extraer datos, obtener información, scraping, selectores
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService, waitForSelector, waitForCondition } from "./browser-service.ts";

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
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome/Chromium.",
      };
    }

    log.info(`Extracting: ${selector}${url ? ` from ${url}` : ""}`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome/Chromium." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      const isXPath = selector.startsWith("xpath:");
      const actualSelector = isXPath ? selector.slice(6) : selector;

      // Esperar el elemento — si no aparece, continuar igual
      try {
        if (isXPath) {
          const xpathExpr = `(() => {
            const r = document.evaluate(
              ${JSON.stringify(actualSelector)}, document, null,
              XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            return r.singleNodeValue !== null;
          })()`;
          await waitForCondition(view, xpathExpr, Math.min(timeout, 10000));
        } else {
          await waitForSelector(view, actualSelector, Math.min(timeout, 10000));
        }
      } catch {
        log.warn(`Selector "${actualSelector}" not found within timeout — attempting extraction anyway`);
      }

      const extracted = await view.evaluate(`
        (() => {
          const isXPath = ${JSON.stringify(isXPath)};
          const sel = ${JSON.stringify(actualSelector)};
          const attr = ${JSON.stringify(attribute)};
          const all = ${JSON.stringify(all)};
          const elements = [];

          if (isXPath) {
            const result = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node.nodeType === Node.ELEMENT_NODE) elements.push(node);
            }
          } else {
            document.querySelectorAll(sel).forEach(el => elements.push(el));
          }

          if (!all && elements.length > 0) elements.length = 1;

          return elements.map(el => {
            if (attr === "text") return (el.textContent || "").trim();
            if (attr === "innerHTML") return el.innerHTML;
            return el.getAttribute(attr) || "";
          });
        })()
      `) as string[];

      const currentUrl = view.url;
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
