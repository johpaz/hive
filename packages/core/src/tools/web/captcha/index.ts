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

type WebViewLike = { url: string; evaluate: (script: string) => Promise<unknown> };

export async function solveCaptcha(
  view: WebViewLike,
  config: CaptchaConfig
): Promise<CaptchaResult> {
  const solver = createSolver(config);
  return solver.detectAndSolve(view as any);
}

export async function checkForCaptcha(
  view: WebViewLike
): Promise<boolean> {
  const challenge = await detectCaptcha(view);
  return challenge !== null;
}

export { createSolver, detectCaptcha, isCaptchaChallengeActive };
