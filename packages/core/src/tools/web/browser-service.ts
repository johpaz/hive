/**
 * BrowserService - Gestiona Chromium via puppeteer
 *
 * Puppeteer descarga y gestiona su propio Chromium automáticamente.
 * Se mantiene una página persistente reutilizada por todos los browser tools.
 *
 * @see https://pptr.dev
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";

const log = logger.child("browser-service");

export class BrowserService {
  private static instance: BrowserService | null = null;
  private available: boolean = false;

  // Persistent browser + page — shared across all tool calls
  private browser: import("puppeteer").Browser | null = null;
  private page: import("puppeteer").Page | null = null;

  private constructor(_config: Config) {}

  static getInstance(config: Config): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config);
    }
    return BrowserService.instance;
  }

  /**
   * Inicia Chromium via puppeteer (auto-descarga si no existe)
   */
  async start(): Promise<boolean> {
    try {
      log.info("Starting Chromium via puppeteer...");

      const puppeteer = await import("puppeteer");

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      // Obtener la página inicial (Chromium abre una en blanco por defecto)
      const pages = await this.browser.pages();
      this.page = pages[0] ?? await this.browser.newPage();

      this.available = true;
      log.info("✅ Chromium ready");
      return true;

    } catch (error) {
      log.error(`Failed to start Chromium: ${(error as Error).message}`);
      this.available = false;
      return false;
    }
  }

  /**
   * Retorna la página persistente, reconectando si es necesario.
   * Todos los browser tools deben usar este método.
   */
  async getPage(): Promise<import("puppeteer").Page | null> {
    if (!this.available) return null;

    try {
      if (this.page && !this.page.isClosed()) {
        return this.page;
      }
      // Página cerrada — crear una nueva en el mismo browser
      if (this.browser && this.browser.connected) {
        this.page = await this.browser.newPage();
        return this.page;
      }
      // Browser desconectado — reiniciar
      log.warn("Browser disconnected — restarting...");
      await this.start();
      return this.page;
    } catch (error) {
      log.error(`getPage failed: ${(error as Error).message}`);
      try {
        await this.start();
        return this.page;
      } catch {
        return null;
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isRunning(): boolean {
    return this.browser !== null && this.browser.connected;
  }

  getInfo(): { running: boolean; startedAt?: number } {
    return { running: this.isRunning() };
  }

  async stop(): Promise<void> {
    this.page = null;
    if (this.browser) {
      try {
        await this.browser.close();
        log.info("✅ Chromium stopped");
      } catch (error) {
        log.error(`Error stopping Chromium: ${(error as Error).message}`);
      }
      this.browser = null;
    }
    this.available = false;
  }

  async dispose(): Promise<void> {
    await this.stop();
    BrowserService.instance = null;
    log.info("BrowserService disposed");
  }
}

let browserServiceInstance: BrowserService | null = null;

export function initializeBrowserService(config: Config): BrowserService {
  browserServiceInstance = BrowserService.getInstance(config);
  return browserServiceInstance;
}

export function getBrowserService(): BrowserService | null {
  return browserServiceInstance;
}
