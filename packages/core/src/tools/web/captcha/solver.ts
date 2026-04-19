/**
 * CAPTCHA Solver Service
 * 
 * Main service that orchestrates CAPTCHA detection and resolution
 */

// TODO: migrar completamente a CDP en Fase 2 (solver usa contentFrame/frame.$ de Puppeteer)
type Page = any; // Usa Bun.WebView en runtime via cast desde browser-navigate.ts
import { logger } from "../../../utils/logger.ts";
import { detectCaptcha, getInstructionFromPage } from './detector.ts';
import { CaptchaVision } from './vision.ts';
import type { 
  CaptchaConfig, 
  CaptchaType, 
  CaptchaResult, 
  CaptchaChallenge 
} from './types';

const log = logger.child("captcha-solver");

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getProviderApiKey(providerId: string): Promise<string | null> {
  try {
    const { getDb } = await import("../../../storage/sqlite.ts");
    const { decryptApiKey } = await import("../../../storage/crypto.ts");
    
    const db = getDb();
    const provider = db.query(
      "SELECT api_key_encrypted, api_key_iv FROM providers WHERE id = ? AND enabled = 1"
    ).get(providerId) as { api_key_encrypted: string; api_key_iv: string } | undefined;
    
    if (provider?.api_key_encrypted && provider?.api_key_iv) {
      return decryptApiKey(provider.api_key_encrypted, provider.api_key_iv);
    }
    return null;
  } catch (error) {
    log.error(`Error getting provider API key: ${(error as Error).message}`);
    return null;
  }
}

export class CaptchaSolver {
  private vision: CaptchaVision | null = null;
  private config: CaptchaConfig;
  private apiKey: string | null = null;
  
  constructor(config: CaptchaConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.apiKey) {
      this.apiKey = this.config.apiKey;
      return;
    }
    
    const providerId = this.config.visionProvider || 'gemini';
    this.apiKey = await getProviderApiKey(providerId);
    
    if (!this.apiKey) {
      this.apiKey = process.env.GEMINI_API_KEY || '';
    }
  }

  private getVision(): CaptchaVision {
    if (!this.vision) {
      if (!this.apiKey) {
        throw new Error('No API key configured for CAPTCHA solver');
      }
      this.vision = new CaptchaVision(this.apiKey, this.config.visionModel);
    }
    return this.vision;
  }

  async detectAndSolve(page: Page): Promise<CaptchaResult> {
    log.info('Starting CAPTCHA detection and solve');
    
    await this.initialize();
    
    const challenge = await detectCaptcha(page);
    
    if (!challenge) {
      log.info('No CAPTCHA detected');
      return {
        success: true,
        solved: false,
        attempts: 0,
        rounds: 0,
        error: 'No CAPTCHA detected',
      };
    }

    return this.solve(page, challenge.type);
  }

  async solve(page: Page, type: CaptchaType): Promise<CaptchaResult> {
    log.info(`Solving CAPTCHA type: ${type}`);
    
    switch (type) {
      case 'text-simple':
        return this.solveTextSimple(page);
      case 'recaptcha-v2-grid':
      case 'recaptcha-v2-audio':
        return this.solveRecaptcha(page, type);
      case 'hcaptcha':
        return this.solveHCaptcha(page);
      case 'turnstile':
        return this.solveTurnstile(page);
      default:
        return {
          success: false,
          solved: false,
          attempts: 0,
          rounds: 0,
          error: `Unsupported CAPTCHA type: ${type}`,
        };
    }
  }

  private async solveTextSimple(page: Page): Promise<CaptchaResult> {
    log.info('Solving text-simple CAPTCHA');
    
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      log.info(`Text CAPTCHA attempt ${attempt}/${this.config.maxAttempts}`);
      
      try {
        const imageElement = await page.$('img[class*="captcha"], img[alt*="captcha"]');
        if (!imageElement) {
          return {
            success: false,
            solved: false,
            attempts: attempt,
            rounds: 0,
            error: 'CAPTCHA image not found',
          };
        }

        const imageBase64 = await imageElement.screenshot({ encoding: 'base64' });
        
        const result = await this.getVision().solveTextCaptcha(imageBase64);
        
        if (result.error) {
          log.warn(`Vision error: ${result.error}`);
          continue;
        }

        const inputSelectors = [
          'input[name*="captcha"]',
          'input[id*="captcha"]',
          'input[type="text"]',
        ];
        
        let inputElement = null;
        for (const sel of inputSelectors) {
          inputElement = await page.$(sel);
          if (inputElement) break;
        }
        
        if (!inputElement) {
          return {
            success: false,
            solved: false,
            attempts: attempt,
            rounds: 0,
            error: 'CAPTCHA input not found',
          };
        }

        await inputElement.type(result.text || '', { delay: 100 });
        
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[class*="submit"]',
          'button:submit',
        ];
        
        for (const sel of submitSelectors) {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
            break;
          }
        }

        const stillPresent = await this.isCaptchaStillPresent(page);
        if (!stillPresent) {
          log.info('Text CAPTCHA solved successfully');
          return {
            success: true,
            solved: true,
            attempts: attempt,
            rounds: 1,
            response: result.text,
          };
        }

      } catch (error) {
        log.error(`Text CAPTCHA attempt ${attempt} failed: ${(error as Error).message}`);
      }
    }

    return {
      success: false,
      solved: false,
      attempts: this.config.maxAttempts,
      rounds: 0,
      error: 'Max attempts exceeded for text CAPTCHA',
    };
  }

  private async solveRecaptcha(page: Page, type: CaptchaType): Promise<CaptchaResult> {
    log.info(`Solving reCAPTCHA (${type})`);
    
    const cellSelections: number[][] = [];
    
    for (let round = 1; round <= this.config.maxRounds; round++) {
      log.info(`reCAPTCHA round ${round}/${this.config.maxRounds}`);
      
      try {
        const iframe = await page.$('iframe[src*="google.com/recaptcha"]');
        if (!iframe) {
          log.info('reCAPTCHA iframe not found, might be solved');
          break;
        }

        const frame = await iframe.contentFrame();
        if (!frame) {
          return {
            success: false,
            solved: false,
            attempts: 0,
            rounds: round,
            error: 'Could not access reCAPTCHA iframe',
          };
        }

        const verifyBtn = await frame.$('#recaptcha-verify-button');
        if (verifyBtn) {
          const isDisabled = await verifyBtn.evaluate((el: any) => el.disabled);
          if (!isDisabled) {
            await verifyBtn.click();
            await delay(1000);
            
            const stillPresent = await this.isCaptchaStillPresent(page);
            if (!stillPresent) {
              return {
                success: true,
                solved: true,
                attempts: 1,
                rounds: round,
                cellSelections,
              };
            }
          }
        }

        const instruction = await getInstructionFromPage(frame);
        
        const challengeFrame = await frame.$('iframe[src*="api2/bframe"]');
        if (challengeFrame) {
          const cFrame = await challengeFrame.contentFrame();
          if (cFrame) {
            const images = await cFrame.$$('td');
            if (images.length > 0) {
              const container = await cFrame.$('.rc-image-challenge-container');
              if (container) {
                const screenshot = await container.screenshot({ encoding: 'base64' });
                const result = await this.getVision().solveGridCaptcha(
                  screenshot, 
                  type,
                  instruction || undefined
                );
                
                if (result.cells && result.cells.length > 0) {
                  cellSelections.push(result.cells);
                  
                  for (const cellIndex of result.cells) {
                    if (cellIndex <= images.length) {
                      const cell = images[cellIndex - 1];
                      if (cell) {
                        await cell.click();
                        await delay(300);
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const verifyButton = await frame.$('#recaptcha-verify-button');
        if (verifyButton) {
          await verifyButton.click();
          await delay(2000);
          
          const stillPresent = await this.isCaptchaStillPresent(page);
          if (!stillPresent) {
            return {
              success: true,
              solved: true,
              attempts: 1,
              rounds: round,
              cellSelections,
            };
          }
        }

      } catch (error) {
        log.error(`reCAPTCHA round ${round} failed: ${(error as Error).message}`);
      }
    }

    return {
      success: false,
      solved: false,
      attempts: this.config.maxRounds,
      rounds: this.config.maxRounds,
      error: 'Max rounds exceeded for reCAPTCHA',
      cellSelections,
    };
  }

  private async solveHCaptcha(page: Page): Promise<CaptchaResult> {
    log.info('Solving hCaptcha');
    
    const cellSelections: number[][] = [];
    
    for (let round = 1; round <= this.config.maxRounds; round++) {
      log.info(`hCaptcha round ${round}/${this.config.maxRounds}`);
      
      try {
        const iframe = await page.$('iframe[src*="hcaptcha.com"]');
        if (!iframe) {
          log.info('hCaptcha iframe not found, might be solved');
          break;
        }

        const frame = await iframe.contentFrame();
        if (!frame) {
          return {
            success: false,
            solved: false,
            attempts: 0,
            rounds: round,
            error: 'Could not access hCaptcha iframe',
          };
        }

        const instruction = await frame.evaluate(() => {
          const el = document.querySelector('[class*="instruction"], .challenge-title');
          return el?.textContent?.trim() || null;
        });

        const challengeContainer = await frame.$('.challenge-container, .hcaptcha-challenge');
        if (challengeContainer) {
          const screenshot = await challengeContainer.screenshot({ encoding: 'base64' });
          
          const result = await this.getVision().solveGridCaptcha(
            screenshot,
            'hcaptcha',
            instruction || undefined
          );

          if (result.cells && result.cells.length > 0) {
            cellSelections.push(result.cells);
            
            const imageCells = await frame.$$('.task-cell, .hcaptcha-task-cell, .image-task, [class*="task-image"]');
            
            for (const cellIndex of result.cells) {
              if (cellIndex <= imageCells.length) {
                const cell = imageCells[cellIndex - 1];
                if (cell) {
                  await cell.click();
                  await delay(300);
                }
              }
            }
          }
        }

        const submitBtn = await frame.$('button[type="submit"], .submit-button, [class*="verify"]');
        if (submitBtn) {
          await submitBtn.click();
          await delay(2000);
          
          const stillPresent = await this.isCaptchaStillPresent(page);
          if (!stillPresent) {
            return {
              success: true,
              solved: true,
              attempts: 1,
              rounds: round,
              cellSelections,
            };
          }
        }

      } catch (error) {
        log.error(`hCaptcha round ${round} failed: ${(error as Error).message}`);
      }
    }

    return {
      success: false,
      solved: false,
      attempts: this.config.maxRounds,
      rounds: this.config.maxRounds,
      error: 'Max rounds exceeded for hCaptcha',
      cellSelections,
    };
  }

  private async solveTurnstile(page: Page): Promise<CaptchaResult> {
    log.info('Solving Cloudflare Turnstile');
    
    try {
      const turnstileSelector = '.cf-turnstile, [class*="turnstile"]';
      const turnstile = await page.$(turnstileSelector);
      
      if (!turnstile) {
        log.info('Turnstile widget not found');
        return {
          success: true,
          solved: false,
          attempts: 0,
          rounds: 0,
          error: 'Turnstile not found',
        };
      }

      const iframe = await page.$('iframe[title*="Cloudflare"]');
      if (iframe) {
        const frame = await iframe.contentFrame();
        if (frame) {
          const checkbox = await frame.$('input[type="checkbox"]');
          if (checkbox) {
            await checkbox.click();
            await delay(2000);
            
            const stillPresent = await this.isCaptchaStillPresent(page);
            if (!stillPresent) {
              return {
                success: true,
                solved: true,
                attempts: 1,
                rounds: 1,
              };
            }
          }
        }
      }

      const isChallenge = await page.evaluate(() => {
        const body = document.body;
        return body?.textContent?.includes('Just a moment') || 
               body?.textContent?.includes('Checking your browser');
      });

      if (isChallenge) {
        log.info('Turnstile managed challenge detected, waiting...');
        await delay(5000);
        
        const stillPresent = await this.isCaptchaStillPresent(page);
        if (!stillPresent) {
          return {
            success: true,
            solved: true,
            attempts: 1,
            rounds: 1,
          };
        }
        
        return {
          success: false,
          solved: false,
          attempts: 1,
          rounds: 1,
          error: 'Turnstile managed challenge - requires manual intervention or reload',
        };
      }

      return {
        success: true,
        solved: true,
        attempts: 1,
        rounds: 1,
      };

    } catch (error) {
      log.error(`Turnstile solving failed: ${(error as Error).message}`);
      return {
        success: false,
        solved: false,
        attempts: 1,
        rounds: 0,
        error: (error as Error).message,
      };
    }
  }

  private async isCaptchaStillPresent(page: Page): Promise<boolean> {
    const challenge = await detectCaptcha(page);
    return challenge !== null;
  }
}

export function createSolver(config: CaptchaConfig): CaptchaSolver {
  return new CaptchaSolver(config);
}
