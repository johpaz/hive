/**
 * browser_screenshot - Take screenshot of current browser page
 *
 * @category web
 * @seedId browser_screenshot
 * @spanish captura de pantalla, screenshot, imagen de página
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { getBrowserService, screenshotElement } from "./browser-service.ts";
import { createArtifact } from "../../artifacts/store.ts";

const log = logger.child("browser-screenshot");

// Default viewport for screenshots — keeps base64 small (~30-60KB vs ~300KB)
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export const browserScreenshotTool: Tool = {
  name: "browser_screenshot",
  description: "Take screenshot of current browser page. Returns JPEG by default for smaller size. Spanish: captura de pantalla, screenshot, imagen de página",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to before screenshot (optional)",
      },
      fullPage: {
        type: "boolean",
        description: "Capture full page height (default: false)",
      },
      selector: {
        type: "string",
        description: "CSS selector of specific element to screenshot (optional)",
      },
      format: {
        type: "string",
        enum: ["jpeg", "png"],
        description: "Image format: jpeg (default, smaller) or png (lossless, larger)",
      },
      quality: {
        type: "number",
        description: "JPEG quality 0-100 (default: 80). Ignored for PNG.",
      },
      width: {
        type: "number",
        description: "Viewport width in pixels (default: 1280). Smaller = smaller file.",
      },
      height: {
        type: "number",
        description: "Viewport height in pixels (default: 720). Smaller = smaller file.",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const url = params.url as string | undefined;
    const fullPage = (params.fullPage as boolean) ?? false;
    const selector = params.selector as string | undefined;
    const format = (params.format as string) ?? "jpeg";
    const quality = (params.quality as number) ?? 80;
    const width = (params.width as number) ?? DEFAULT_VIEWPORT.width;
    const height = (params.height as number) ?? DEFAULT_VIEWPORT.height;

    const browserService = getBrowserService();
    if (!browserService?.isAvailable()) {
      log.warn("Browser not available");
      return {
        ok: false,
        error: "Browser automation not available. Install Chrome or Chromium (or run `hive doctor`).",
      };
    }

    log.info(`Taking screenshot${url ? ` of: ${url}` : ""}${selector ? ` (element: ${selector})` : ""} [${format} ${width}x${height}]`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install Chrome or Chromium (or run `hive doctor`)." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      // Fijar el viewport es un intento, no un requisito: `Emulation.setDevice
      // MetricsOverride` no existe en todos los motores —y falla si todavía no
      // se navegó a ninguna página—. Sin esto, un resize que no se puede hacer
      // tiraba abajo la captura entera.
      try {
        await view.resize(width, height);
        await Bun.sleep(200);
      } catch (error) {
        log.info(`el motor no permite fijar el viewport: ${(error as Error).message}`);
      }

      let screenshot: string;

      if (selector) {
        screenshot = await screenshotElement(view, selector);
      } else {
        screenshot = await view.screenshot({
          encoding: "base64",
          format: format as "jpeg" | "png" | "webp",
          quality: format === "jpeg" ? quality : undefined,
        });
      }

      const currentUrl = view.url;
      const bytes = Buffer.from(screenshot, "base64");
      const effectiveFormat = selector ? "png" : format;
      const mimeType = effectiveFormat === "png" ? "image/png" : "image/jpeg";
      const configurable = config?.configurable ?? {};
      const artifact = await createArtifact({
        bytes,
        mimeType,
        kind: "browser_screenshot",
        userId: String(configurable.user_id ?? ""),
        runId: configurable.run_id ? String(configurable.run_id) : null,
        taskId: configurable.task_id ? String(configurable.task_id) : null,
        rootDir: configurable.artifact_dir ? String(configurable.artifact_dir) : undefined,
        width,
        height,
      });
      log.info(`Screenshot stored as artifact ${artifact.id} (${artifact.size} bytes, ${mimeType})`);

      return {
        ok: true,
        url: currentUrl,
        artifact_id: artifact.id,
        kind: artifact.kind,
        mime_type: artifact.mime_type,
        size: artifact.size,
        sha256: artifact.sha256,
        status: artifact.status,
        expires_at: artifact.expires_at,
        format: effectiveFormat,
        fullPage,
        selector,
        viewport: { width, height },
      };
    } catch (error) {
      log.error(`Screenshot failed: ${(error as Error).message}`);
      return { ok: false, error: `Failed to take screenshot: ${(error as Error).message}` };
    }
  },
};
