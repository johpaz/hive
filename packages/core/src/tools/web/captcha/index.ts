/**
 * CAPTCHA Module - Exports
 * 
 * Detection and resolution of CAPTCHAs using vision models
 */

export * from './types.ts';
export * from './detector.ts';
export * from './vision.ts';
export * from './solver.ts';

import { createSolver, type CaptchaSolver } from './solver.ts';
import { detectCaptcha, isCaptchaChallengeActive } from './detector.ts';
import type { CaptchaConfig, CaptchaResult } from './types.ts';

export type { Page } from 'puppeteer';

export async function solveCaptcha(
  page: import('puppeteer').Page,
  config: CaptchaConfig
): Promise<CaptchaResult> {
  const solver = createSolver(config);
  return solver.detectAndSolve(page);
}

export async function checkForCaptcha(
  page: import('puppeteer').Page
): Promise<boolean> {
  const challenge = await detectCaptcha(page);
  return challenge !== null;
}

export { createSolver, detectCaptcha, isCaptchaChallengeActive };
