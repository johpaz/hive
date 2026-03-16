/**
 * BrowserService - Gestiona Lightpanda via @lightpanda/browser
 * 
 * Lightpanda se inicia automáticamente como proceso interno.
 * Hive se conecta via CDP usando puppeteer-core.
 * 
 * @see https://lightpanda.io
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

      // Importar @lightpanda/browser dinámicamente
      const { lightpanda } = await import("@lightpanda/browser");

      // Iniciar Lightpanda como proceso separado
      const proc = await lightpanda.serve({
        host: CDP_HOST,
        port: CDP_PORT,
      });

      log.info(`✅ Lightpanda iniciado en ${CDP_HOST}:${CDP_PORT}`);

      this.lightpandaProcess = {
        proc,
        startedAt: Date.now(),
      };

      // Esperar un momento para que esté listo
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verificar que está disponible
      const isRunning = await this.checkConnection();
      
      if (isRunning) {
        this.available = true;
        log.info("✅ Lightpanda ready for CDP connections");
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
   * Obtiene conexión CDP para puppeteer-core
   */
  async getConnection(): Promise<import("puppeteer-core").Browser | null> {
    if (!this.available) {
      return null;
    }

    try {
      const puppeteer = await import("puppeteer-core");
      
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://${CDP_HOST}:${CDP_PORT}`,
        defaultViewport: null,
      });

      return browser;
    } catch (error) {
      log.error(`Failed to connect via CDP: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Retorna si Lightpanda está disponible
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Retorna si el proceso está corriendo
   */
  isRunning(): boolean {
    return this.lightpandaProcess !== null;
  }

  /**
   * Obtiene información del proceso
   */
  getInfo(): { running: boolean; port: number; host: string; startedAt?: number } {
    return {
      running: this.isRunning(),
      port: CDP_PORT,
      host: CDP_HOST,
      startedAt: this.lightpandaProcess?.startedAt,
    };
  }

  /**
   * Detiene Lightpanda
   */
  async stop(): Promise<void> {
    if (this.lightpandaProcess) {
      try {
        log.info("Stopping Lightpanda...");
        
        // Limpiar proceso
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

  /**
   * Limpia recursos al cerrar Gateway
   */
  async dispose(): Promise<void> {
    await this.stop();
    BrowserService.instance = null;
    log.info("BrowserService disposed");
  }
}

/**
 * Singleton instance
 */
let browserServiceInstance: BrowserService | null = null;

export function initializeBrowserService(config: Config): BrowserService {
  browserServiceInstance = BrowserService.getInstance(config);
  return browserServiceInstance;
}

export function getBrowserService(): BrowserService | null {
  return browserServiceInstance;
}
