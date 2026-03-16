/**
 * Browser API Routes
 * 
 * Endpoints para gestión de Lightpanda browser.
 * Solo accesible con auth token.
 */

import type { Context } from "hono";
import { getDb } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { getBrowserService, initializeBrowserService } from "../../tools/web/browser-service";

const log = logger.child("api:browser");

/**
 * GET /api/browser/status
 * Retorna el estado actual de Lightpanda
 */
export async function handleGetBrowserStatus(c: Context) {
  try {
    const browserService = getBrowserService();
    const info = browserService?.getInfo() ?? { running: false, port: 9222, host: "127.0.0.1" };
    
    // Verificar si browser está disponible para CDP
    let browserAvailable = false;
    if (browserService) {
      browserAvailable = browserService.isAvailable();
    }

    // Contar browser tools activas
    const db = getDb();
    const browserToolsCount = db.query(`
      SELECT COUNT(*) as count FROM tools 
      WHERE category = 'web' AND id LIKE 'browser_%' AND active = 1
    `).get() as { count: number };

    return c.json({
      success: true,
      data: {
        running: info.running,
        browserAvailable,
        port: info.port,
        host: info.host,
        cdpUrl: `ws://${info.host}:${info.port}`,
        browserToolsActive: browserToolsCount.count,
        startedAt: info.startedAt,
      },
    });
  } catch (error) {
    log.error(`Error getting browser status: ${(error as Error).message}`);
    return c.json({
      success: false,
      error: (error as Error).message,
    }, 500);
  }
}

/**
 * POST /api/browser/start
 * Inicia Lightpanda
 */
export async function handleStartBrowser(c: Context) {
  try {
    log.info("Starting Lightpanda via API...");

    const browserService = getBrowserService();
    if (!browserService) {
      return c.json({
        success: false,
        message: "Browser service not initialized",
      }, 500);
    }

    // Verificar si ya está corriendo
    if (browserService.isRunning()) {
      return c.json({
        success: true,
        message: "Lightpanda ya está corriendo",
        data: {
          running: true,
          action: "already_running",
        },
      });
    }

    // Iniciar Lightpanda
    const started = await browserService.start();

    if (started) {
      // Activar browser tools
      try {
        const { activateBrowserTools } = await import("../../storage/onboarding");
        activateBrowserTools();
        
        return c.json({
          success: true,
          message: "Lightpanda iniciado y browser tools activadas",
          data: {
            running: true,
            action: "started",
            cdpUrl: `ws://127.0.0.1:9222`,
          },
        });
      } catch (error) {
        log.warn(`Error activando browser tools: ${(error as Error).message}`);
      }

      return c.json({
        success: true,
        message: "Lightpanda iniciado correctamente",
        data: {
          running: true,
          action: "started",
          cdpUrl: `ws://127.0.0.1:9222`,
        },
      });
    }

    return c.json({
      success: false,
      message: "No se pudo iniciar Lightpanda",
      data: {
        running: false,
        action: "start_failed",
      },
    }, 500);

  } catch (error) {
    log.error(`Error starting Lightpanda: ${(error as Error).message}`);
    return c.json({
      success: false,
      error: (error as Error).message,
    }, 500);
  }
}

/**
 * POST /api/browser/stop
 * Detiene Lightpanda
 */
export async function handleStopBrowser(c: Context) {
  try {
    log.info("Stopping Lightpanda via API...");

    const browserService = getBrowserService();
    if (!browserService) {
      return c.json({
        success: false,
        message: "Browser service not initialized",
      }, 500);
    }

    // Verificar si está corriendo
    if (!browserService.isRunning()) {
      return c.json({
        success: true,
        message: "Lightpanda no está corriendo",
        data: {
          running: false,
          action: "already_stopped",
        },
      });
    }

    // Detener Lightpanda
    await browserService.stop();

    // Desactivar browser tools
    try {
      const db = getDb();
      db.run(`UPDATE tools SET active = 0 WHERE id LIKE 'browser_%'`);
      log.info("Browser tools desactivadas");
    } catch (error) {
      log.warn(`Error desactivando browser tools: ${(error as Error).message}`);
    }

    return c.json({
      success: true,
      message: "Lightpanda detenido",
      data: {
        running: false,
        action: "stopped",
      },
    });

  } catch (error) {
    log.error(`Error stopping Lightpanda: ${(error as Error).message}`);
    return c.json({
      success: false,
      error: (error as Error).message,
    }, 500);
  }
}
