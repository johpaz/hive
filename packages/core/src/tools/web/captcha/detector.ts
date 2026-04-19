/**
 * CAPTCHA Detector
 *
 * Detects what type of CAPTCHA is present on the page using CSS selectors.
 * Compatible con Bun.WebView (view.url + view.evaluate).
 */

import { logger } from "../../../utils/logger.ts";
import { CAPTCHA_SELECTORS, type CaptchaType, type CaptchaChallenge } from './types';

const log = logger.child("captcha-detector");

type WebViewLike = { url: string; evaluate: (script: string) => Promise<unknown> };

export async function detectCaptcha(view: WebViewLike): Promise<CaptchaChallenge | null> {
  try {
    if (!view) {
      log.error("View object is null or undefined");
      return null;
    }

    const url = view.url;
    if (!url) {
      log.error("View URL is empty or undefined");
      return null;
    }

    log.info(`Detecting CAPTCHA on: ${url}`);

    // Inlinear los selectores en el script para compatibilidad con Bun.WebView
    const result = await view.evaluate(`
      (() => {
        const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
        const url = ${JSON.stringify(url)};

        function exists(sel) {
          try { return document.querySelector(sel) !== null; } catch { return false; }
        }
        function getAttribute(sel, attr) {
          try {
            const el = document.querySelector(sel);
            return el?.getAttribute(attr) || undefined;
          } catch { return undefined; }
        }
        function getIframeSrc(sel) {
          try {
            const el = document.querySelector(sel);
            return el?.src || undefined;
          } catch { return undefined; }
        }

        for (const sel of selectors.recaptcha) {
          if (exists(sel)) {
            return {
              type: 'recaptcha-v2-grid',
              siteKey: getAttribute('[data-sitekey]', 'data-sitekey') ||
                       getAttribute('[class*="g-recaptcha"]', 'data-sitekey'),
              url,
              iframeSrc: getIframeSrc('iframe[src*="google.com/recaptcha"]'),
            };
          }
        }
        for (const sel of selectors.hcaptcha) {
          if (exists(sel)) {
            return {
              type: 'hcaptcha',
              siteKey: getAttribute('[data-sitekey]', 'data-sitekey') ||
                       getAttribute('[class*="h-captcha"]', 'data-sitekey'),
              url,
              iframeSrc: getIframeSrc('iframe[src*="hcaptcha.com"]'),
            };
          }
        }
        for (const sel of selectors.turnstile) {
          if (exists(sel)) {
            return {
              type: 'turnstile',
              siteKey: getAttribute('[data-sitekey]', 'data-sitekey') ||
                       getAttribute('[class*="cf-turnstile"]', 'data-sitekey'),
              url,
              iframeSrc: getIframeSrc('iframe[src*="challenges.cloudflare.com"]'),
            };
          }
        }
        const captchaImgs = ['img[alt*="captcha"]','img[alt*="CAPTCHA"]','img[class*="captcha"]','img[class*="Captcha"]','img[id*="captcha"]'];
        for (const sel of captchaImgs) {
          if (exists(sel)) {
            const inputs = ['input[name*="captcha"]','input[name*="Captcha"]','input[id*="captcha"]','input[id*="Captcha"]'];
            for (const inp of inputs) {
              if (exists(inp)) return { type: 'text-simple', url };
            }
          }
        }
        return null;
      })()
    `) as CaptchaChallenge | null;

    if (result) {
      log.info(`CAPTCHA detected: ${result.type} on ${result.url}`);
      return result;
    }

    log.debug(`No CAPTCHA detected on ${url}`);
    return null;
  } catch (error) {
    log.error(`Error detecting CAPTCHA: ${(error as Error).message}`);
    return null;
  }
}

export async function isCaptchaChallengeActive(view: WebViewLike): Promise<boolean> {
  try {
    const isVisible = await view.evaluate(`
      (() => {
        const sels = ['.g-recaptcha','.h-captcha','.cf-turnstile','[data-sitekey]',
          'iframe[src*="recaptcha"]','iframe[src*="hcaptcha"]','iframe[src*="cloudflare"]'];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden';
          }
        }
        return false;
      })()
    `);
    return !!isVisible;
  } catch {
    return false;
  }
}

export function getInstructionFromPage(view: WebViewLike): Promise<string | null> {
  return view.evaluate(`
    (() => {
      const sels = ['.rc-imageselect-instructions','.rc-imageselect-instructions-default',
        '[class*="instruction"],[class*="challenge"]','p[class*="instruction"]','div[class*="instruction"]'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim()) return el.textContent.trim();
      }
      return null;
    })()
  `) as Promise<string | null>;
}
