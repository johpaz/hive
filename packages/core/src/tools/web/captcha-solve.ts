/**
 * captcha_solve - Manually trigger CAPTCHA solving
 *
 * Use this tool when browser_navigate detects a CAPTCHA but you want to
 * manually trigger the solving process, or when you need to solve a CAPTCHA
 * that appeared after some interaction.
 *
 * @category web
 * @seedId captcha_solve
 * @spanish resolver captcha, captcha, verificar
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService } from "./browser-service.ts";
import { detectCaptcha, createSolver } from "./captcha/index.ts";

const log = logger.child("captcha-solve");

export const captchaSolveTool: Tool = {
  name: "captcha_solve",
  description: "Solve CAPTCHA on current page using vision AI. Spanish: resolver captcha, verificar captcha",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["auto", "text-simple", "recaptcha-v2-grid", "hcaptcha", "turnstile"],
        description: "CAPTCHA type to solve. 'auto' detects automatically.",
      },
      force: {
        type: "boolean",
        description: "Force solving even if no CAPTCHA is detected (default: false)",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const type = params.type as string | undefined;
    const force = (params.force as boolean) ?? false;

    const browserService = getBrowserService();
    if (!browserService || !browserService.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available.",
      };
    }

    try {
      const page = await browserService.getPage();
      if (!page) {
        throw new Error("Failed to get browser page");
      }

      const challenge = await detectCaptcha(page);
      
      if (!challenge && !force) {
        return {
          ok: true,
          message: "No CAPTCHA detected on current page",
          detected: false,
        };
      }

      const captchaType = type === "auto" || !type 
        ? (challenge?.type || "unknown")
        : type as any;

      log.info(`Solving CAPTCHA: ${captchaType}`);

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

      await solver.initialize();
      const result = await solver.solve(page, captchaType);

      if (result.success && result.solved) {
        log.info(`CAPTCHA solved successfully in ${result.rounds} rounds`);
        return {
          ok: true,
          solved: true,
          type: captchaType,
          attempts: result.attempts,
          rounds: result.rounds,
          cellSelections: result.cellSelections,
        };
      } else {
        log.warn(`CAPTCHA solving failed: ${result.error}`);
        return {
          ok: true,
          solved: false,
          type: captchaType,
          error: result.error,
          attempts: result.attempts,
          rounds: result.rounds,
        };
      }

    } catch (error) {
      log.error(`CAPTCHA solving error: ${(error as Error).message}`);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  },
};
