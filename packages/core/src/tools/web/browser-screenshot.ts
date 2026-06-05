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
  execute: async (params: Record<string, unknown>) => {
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
        error: "Browser automation not available. Install agent-browser.",
      };
    }

    log.info(`Taking screenshot${url ? ` of: ${url}` : ""}${selector ? ` (element: ${selector})` : ""} [${format} ${width}x${height}]`);

    try {
      const view = await browserService.getView();
      if (!view) return { ok: false, error: "Browser automation not available. Install agent-browser." };

      if (url) {
        await view.navigate(url);
        await Bun.sleep(500);
      }

      // Resize viewport before screenshot to keep image small
      await view.resize(width, height);
      await Bun.sleep(200);

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
      log.info(`Screenshot captured: ${currentUrl} (${screenshot.length} base64 chars, ${format})`);

      return {
        ok: true,
        url: currentUrl,
        screenshot,
        format,
        encoding: "base64",
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
