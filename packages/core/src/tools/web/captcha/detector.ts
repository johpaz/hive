/**
 * CAPTCHA Detector
 * 
 * Detects what type of CAPTCHA is present on the page using CSS selectors
 */

import type { Page } from 'puppeteer';
import { logger } from "../../../utils/logger.ts";
import { CAPTCHA_SELECTORS, type CaptchaType, type CaptchaChallenge } from './types';

const log = logger.child("captcha-detector");

export async function detectCaptcha(page: Page): Promise<CaptchaChallenge | null> {
  try {
    if (!page) {
      log.error("Page object is null or undefined");
      return null;
    }
    
    const url = page.url();
    if (!url) {
      log.error("Page URL is empty or undefined");
      return null;
    }
    
    log.info(`Detecting CAPTCHA on: ${url}`);

    const result = await page.evaluate((selectors) => {
      function exists(sel: string): boolean {
        try {
          return document.querySelector(sel) !== null;
        } catch {
          return false;
        }
      }

      function getAttribute(sel: string, attr: string): string | undefined {
        try {
          const el = document.querySelector(sel);
          return el?.getAttribute(attr) || undefined;
        } catch {
          return undefined;
        }
      }

      function getIframeSrc(sel: string): string | undefined {
        try {
          const el = document.querySelector(sel) as HTMLIFrameElement | null;
          return el?.src || undefined;
        } catch {
          return undefined;
        }
      }

      for (const sel of selectors.recaptcha) {
        if (exists(sel)) {
          const siteKey = getAttribute('[data-sitekey]', 'data-sitekey') || 
                        getAttribute('[class*="g-recaptcha"]', 'data-sitekey');
          const iframeSrc = getIframeSrc('iframe[src*="google.com/recaptcha"]');
          
          return {
            type: 'recaptcha-v2-grid' as CaptchaType,
            siteKey: siteKey || undefined,
            url,
            iframeSrc,
          };
        }
      }

      for (const sel of selectors.hcaptcha) {
        if (exists(sel)) {
          const siteKey = getAttribute('[data-sitekey]', 'data-sitekey') || 
                        getAttribute('[class*="h-captcha"]', 'data-sitekey');
          const iframeSrc = getIframeSrc('iframe[src*="hcaptcha.com"]');
          
          return {
            type: 'hcaptcha' as CaptchaType,
            siteKey: siteKey || undefined,
            url,
            iframeSrc,
          };
        }
      }

      for (const sel of selectors.turnstile) {
        if (exists(sel)) {
          const siteKey = getAttribute('[data-sitekey]', 'data-sitekey') || 
                        getAttribute('[class*="cf-turnstile"]', 'data-sitekey');
          const iframeSrc = getIframeSrc('iframe[src*="challenges.cloudflare.com"]');
          
          return {
            type: 'turnstile' as CaptchaType,
            siteKey: siteKey || undefined,
            url,
            iframeSrc,
          };
        }
      }

      const captchaImgSelectors = [
        'img[alt*="captcha"]',
        'img[alt*="CAPTCHA"]',
        'img[class*="captcha"]',
        'img[class*="Captcha"]',
        'img[id*="captcha"]',
      ];
      
      for (const sel of captchaImgSelectors) {
        if (exists(sel)) {
          const inputSelectors = [
            'input[name*="captcha"]',
            'input[name*="Captcha"]',
            'input[id*="captcha"]',
            'input[id*="Captcha"]',
          ];
          
          for (const inputSel of inputSelectors) {
            if (exists(inputSel)) {
              return {
                type: 'text-simple' as CaptchaType,
                url,
              };
            }
          }
        }
      }

      return null;
    }, CAPTCHA_SELECTORS);

    if (result) {
      log.info(`CAPTCHA detected: ${result.type} on ${result.url}`);
      return result as CaptchaChallenge;
    }

    log.debug(`No CAPTCHA detected on ${url}`);
    return null;

  } catch (error) {
    log.error(`Error detecting CAPTCHA: ${(error as Error).message}`);
    return null;
  }
}

export async function isCaptchaChallengeActive(page: Page): Promise<boolean> {
  try {
    const isVisible = await page.evaluate(() => {
      const selectors = [
        '.g-recaptcha',
        '.h-captcha', 
        '.cf-turnstile',
        '[data-sitekey]',
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="cloudflare"]',
      ];
      
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }
      }
      return false;
    });
    
    return isVisible;
  } catch {
    return false;
  }
}

export function getInstructionFromPage(page: Page | { evaluate: (fn: (() => any) | string) => Promise<any> }): Promise<string | null> {
  return page.evaluate(() => {
    const selectors = [
      '.rc-imageselect-instructions',
      '.rc-imageselect-instructions-default',
      '[class*="instruction"]',
      '[class*="challenge"]',
      'p[class*="instruction"]',
      'div[class*="instruction"]',
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }
    return null;
  });
}
