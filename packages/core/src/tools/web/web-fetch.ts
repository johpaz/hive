/**
 * web_fetch - Fetch plain content from a URL
 * 
 * @category web
 * @seedId web_fetch
 * @spanish obtener página, descargar contenido, extraer texto de url
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("web-fetch");

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch plain content from a URL (lightweight, no JS). Spanish: obtener página, descargar contenido, extraer texto de url",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch content from",
      },
    },
    required: ["url"],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string;

    log.info(`Fetching: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HiveBot/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      let content: string;

      if (contentType.includes("application/json")) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else if (contentType.includes("text/html")) {
        const html = await response.text();
        // Strip HTML tags
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 50000);
      } else {
        content = await response.text();
      }

      return {
        ok: true,
        url,
        content,
        contentType,
        length: content.length,
      };
    } catch (error) {
      log.error(`Fetch failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to fetch URL: ${(error as Error).message}`,
      };
    }
  },
};
