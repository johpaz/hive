/**
 * BrowserService - Gestiona Lightpanda via @lightpanda/browser
 *
 * Lightpanda se inicia automáticamente como proceso interno.
 * Hive se conecta via CDP usando puppeteer-core.
 *
 * IMPORTANTE: Lightpanda solo soporta UNA conexión activa por proceso y UNA
 * página activa a la vez. El servicio mantiene una página persistente y
 * la reutiliza en todos los tools (no se crea/cierra por cada llamada).
 *
 * @see https://github.com/lightpanda-io/browser
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";

const log = logger.child("browser-service");

const CDP_PORT = 9222;
const CDP_HOST = "127.0.0.1";

interface LightpandaProcess {
  proc: any;
  startedAt: number;
}

export class BrowserService {
  private static instance: BrowserService | null = null;
  private lightpandaProcess: LightpandaProcess | null = null;
  private available: boolean = false;
  private config: Config["tools"]["browser"];

  // Persistent connection — Lightpanda supports only ONE active connection
  private browser: import("puppeteer-core").Browser | null = null;
  private page: import("puppeteer-core").Page | null = null;

  private constructor(config: Config) {
    this.config = config.tools?.browser ?? {};
  }

  static getInstance(config: Config): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config);
    }
    return BrowserService.instance;
  }

  /**
   * Inicia Lightpanda automáticamente usando @lightpanda/browser
   */
  async start(): Promise<boolean> {
    try {
      log.info("Starting Lightpanda browser...");

      const { lightpanda } = await import("@lightpanda/browser");

      const proc = await lightpanda.serve({
        host: CDP_HOST,
        port: CDP_PORT,
      });

      log.info(`✅ Lightpanda iniciado en ${CDP_HOST}:${CDP_PORT}`);

      this.lightpandaProcess = {
        proc,
        startedAt: Date.now(),
      };

      // Esperar a que esté listo
      await new Promise(resolve => setTimeout(resolve, 1000));

      const isRunning = await this.checkConnection();

      if (isRunning) {
        this.available = true;
        log.info("✅ Lightpanda ready for CDP connections");
        // Establecer conexión y página persistente desde el inicio
        await this.ensurePage();
        return true;
      } else {
        log.warn("⚠️  Lightpanda started but CDP not responding");
        return false;
      }

    } catch (error) {
      log.error(`Failed to start Lightpanda: ${(error as Error).message}`);
      this.available = false;
      return false;
    }
  }

  /**
   * Verifica conexión CDP
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Retorna la página persistente, reconectando si es necesario.
   * Todos los browser tools deben usar este método en vez de getConnection().
   *
   * Lightpanda: una conexión, un contexto, una página activa.
   */
  async getPage(): Promise<import("puppeteer-core").Page | null> {
    if (!this.available) return null;

    try {
      // Si la página existe y no está cerrada, reutilizarla
      if (this.page && !this.page.isClosed()) {
        return this.page;
      }
      // Si el browser existe pero la página murió, intentar recuperarla
      if (this.browser && this.browser.connected) {
        const pages = await this.browser.pages().catch(() => []);
        if (pages.length > 0) {
          this.page = pages[0];
          return this.page;
        }
        this.page = await this.browser.newPage();
        return this.page;
      }
      // Reconectar todo
      await this.ensurePage();
      return this.page;
    } catch (error) {
      log.warn(`getPage: reconnecting after error — ${(error as Error).message}`);
      try {
        await this.ensurePage();
        return this.page;
      } catch (reconnectError) {
        log.error(`getPage: reconnect failed — ${(reconnectError as Error).message}`);
        return null;
      }
    }
  }

  /**
   * Establece (o restablece) la conexión persistente y la página.
   */
  private async ensurePage(): Promise<void> {
    // Desconectar conexión anterior si existe
    if (this.browser) {
      try { this.browser.disconnect(); } catch { /* ignore */ }
      this.browser = null;
      this.page = null;
    }

    const puppeteer = await import("puppeteer-core");

    this.browser = await puppeteer.connect({
      browserWSEndpoint: `ws://${CDP_HOST}:${CDP_PORT}`,
      defaultViewport: { width: 1920, height: 1080 },
    });

    const pages = await this.browser.pages().catch(() => [] as import("puppeteer-core").Page[]);
    this.page = pages[0] ?? await this.browser.newPage();

    log.info("Browser page established (persistent)");
  }

  /**
   * @deprecated Usar getPage() — mantiene la conexión persistente.
   */
  async getConnection(): Promise<import("puppeteer-core").Browser | null> {
    if (!this.available) return null;
    try {
      if (!this.browser || !this.browser.connected) {
        await this.ensurePage();
      }
      return this.browser;
    } catch (error) {
      log.error(`getConnection failed: ${(error as Error).message}`);
      return null;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isRunning(): boolean {
    return this.lightpandaProcess !== null;
  }

  getInfo(): { running: boolean; port: number; host: string; startedAt?: number } {
    return {
      running: this.isRunning(),
      port: CDP_PORT,
      host: CDP_HOST,
      startedAt: this.lightpandaProcess?.startedAt,
    };
  }

  async stop(): Promise<void> {
    this.page = null;
    if (this.browser) {
      try { this.browser.disconnect(); } catch { /* ignore */ }
      this.browser = null;
    }
    if (this.lightpandaProcess) {
      try {
        log.info("Stopping Lightpanda...");
        this.lightpandaProcess.proc.stdout?.destroy();
        this.lightpandaProcess.proc.stderr?.destroy();
        this.lightpandaProcess.proc.kill();
        this.lightpandaProcess = null;
        this.available = false;
        log.info("✅ Lightpanda stopped");
      } catch (error) {
        log.error(`Error stopping Lightpanda: ${(error as Error).message}`);
      }
    }
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
