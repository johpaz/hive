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
        error: "Browser automation not available. Lightpanda must be running.",
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

      // Crear página nueva para aislamiento
      page = await browser.newPage();

      // Set timeout
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      // Navigate to URL con waitUntil más robusto
      const response = await page.goto(url, {
        waitUntil: ["domcontentloaded", "networkidle2"],
        timeout,
      });

      if (!response) {
        throw new Error("Navigation failed - no response");
      }

      // Esperar un momento para que JS termine de ejecutar
      await new Promise(resolve => setTimeout(resolve, 500));

      // Wait for specific selector if provided
      if (waitFor) {
        try {
          await page.waitForSelector(waitFor, { 
            timeout,
          });
        } catch (e) {
          log.warn(`Selector "${waitFor}" not found within timeout`);
        }
      }

      // Get final URL (after redirects)
      const finalUrl = page.url();

      // Extract content - remove scripts and styles, keep text
      const content = await page.evaluate(() => {
        try {
          // Remove script and style elements
          document.querySelectorAll("script, style, noscript, meta, link, iframe").forEach(el => el.remove());
          
          // Get text content
          let text = document.body.innerText || document.documentElement.innerText || "";
          
          // Clean up whitespace
          text = text.replace(/\s+/g, " ").trim();
          
          // Limit to 50000 characters
          return text.slice(0, 50000);
        } catch (e) {
          // Fallback si el DOM no está disponible
          return "Error extracting content: " + (e as Error).message;
        }
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
      const errorMessage = (error as Error).message;
      
      // Manejar errores específicos
      if (errorMessage.includes("detached")) {
        log.error("Navigation failed: page was detached (likely navigated away or closed)");
        return {
          ok: false,
          error: "La página se cerró durante la navegación. Intenta nuevamente.",
        };
      }
      
      if (errorMessage.includes("timeout")) {
        log.error(`Navigation timeout: ${url}`);
        return {
          ok: false,
          error: `Tiempo de espera agotado (${timeout}ms). La página puede ser lenta o el URL incorrecto.`,
        };
      }
      
      log.error(`Navigation failed: ${errorMessage}`);
      return {
        ok: false,
        error: `Failed to navigate: ${errorMessage}`,
      };
    } finally {
      // Cerrar página para limpiar recursos
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch {
          // Ignorar errores al cerrar
        }
      }
    }
  },
};
