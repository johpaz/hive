/**
 * Unit tests para la detección de agent-browser.
 *
 * Con la migración a agent-browser, la detección de Chrome/Chromium nativo
 * ya no es necesaria. Estos tests verifican compatibilidad de exports.
 */

import { describe, expect, it } from "bun:test";
import { detectBrowser, type LaunchSpec } from "../packages/core/src/tools/web/browser-service.ts";

describe("detectBrowser (deprecated)", () => {
  it("always returns undefined since agent-browser handles detection internally", () => {
    const result = detectBrowser();
    expect(result).toBeUndefined();
  });

  it("accepts a remote LaunchSpec for backwards compatibility", () => {
    const spec: LaunchSpec = { kind: "remote", cdpUrl: "ws://10.0.0.5:9222" };
    expect(spec.kind).toBe("remote");
    if (spec.kind === "remote") {
      expect(spec.cdpUrl).toBe("ws://10.0.0.5:9222");
    }
  });
});
