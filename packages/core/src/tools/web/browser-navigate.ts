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
import { detectCaptcha, createSolver } from "./captcha/index.ts";

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

    try {
      const page = await browserService.getPage();
      if (!page) {
        throw new Error("Failed to get browser page");
      }

      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      // Lightpanda soporta "domcontentloaded" y "networkidle0".
      // No soporta "networkidle2" ni arrays de waitUntil.
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      // Lightpanda puede retornar null en redirects — no es un error fatal
      const statusCode = response?.status() ?? 0;

      // Esperar a que JS termine de ejecutar
      await new Promise(resolve => setTimeout(resolve, 500));

      // Esperar selector específico si se proporcionó
      if (waitFor) {
        try {
          await page.waitForSelector(waitFor, { timeout });
        } catch {
          log.warn(`Selector "${waitFor}" not found within timeout`);
        }
      }

      const finalUrl = page.url();

      // Check for CAPTCHA and attempt to solve
      const captchaChallenge = await detectCaptcha(page);
      let captchaResult = null;
      
      if (captchaChallenge) {
        log.info(`CAPTCHA detected: ${captchaChallenge.type}`);
        
        const solver = createSolver({
          enabled: true,
          autoSolve: true,
          visionProvider: 'gemini',
          visionModel: 'gemini-2.0-flash-exp',
          maxAttempts: 3,
          maxRounds: 5,
          apiKey: '',
          enabledSites: [],
        });
        
        try {
          await solver.initialize();
          captchaResult = await solver.solve(page, captchaChallenge.type);
          if (captchaResult.success && captchaResult.solved) {
            log.info(`CAPTCHA solved successfully`);
          } else {
            log.warn(`CAPTCHA solving failed: ${captchaResult.error}`);
          }
        } catch (error) {
          log.error(`CAPTCHA solving error: ${(error as Error).message}`);
          captchaResult = { success: false, error: (error as Error).message };
        }
      }

      // Extraer texto limpio del DOM
      const content = await page.evaluate(() => {
        try {
          document.querySelectorAll("script, style, noscript, meta, link, iframe").forEach(el => el.remove());
          let text = document.body?.innerText || document.documentElement?.innerText || "";
          text = text.replace(/\s+/g, " ").trim();
          return text.slice(0, 50000);
        } catch (e) {
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
        statusCode,
        captcha: captchaChallenge ? {
          type: captchaChallenge.type,
          detected: true,
          solved: captchaResult?.solved || false,
          error: captchaResult?.error,
        } : undefined,
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
