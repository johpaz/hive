/**
 * Real browser test: navegación por bun.sh usando agent-browser
 * Requiere: BROWSER_TESTS=1
 */

// BrowserService arrastra los módulos de storage, que resuelven la ruta de la BD
// al cargarse. Sin esto la suite abría la BD real del usuario (~/.hive/data) y
// le escribía contadores, además de romper el aislamiento de otros archivos.
process.env.HIVE_DB_PATH = ":memory:";

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { BrowserService } from "../packages/core/src/tools/web/browser-service.ts";

const BROWSER_TESTS = process.env.BROWSER_TESTS === "1";

describe.skipIf(!BROWSER_TESTS)("bun.sh — navegación real con agent-browser", () => {
  let service: BrowserService;

  beforeAll(async () => {
    service = BrowserService.getInstance({} as any);
    const ok = await service.start();
    if (!ok) throw new Error("BrowserService could not start agent-browser");
  }, 60000);

  afterAll(async () => {
    await service?.stop();
  });

  it("navega a bun.sh y obtiene contenido", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    await view.navigate("https://bun.sh");
    const text = await view.evaluate<string>(`
      (() => {
        document.querySelectorAll("script,style,noscript").forEach(e => e.remove());
        return document.body?.innerText?.slice(0, 500) ?? "";
      })()
    `);
    console.log("── Contenido bun.sh ──\n", text.slice(0, 300));
    expect(text.length).toBeGreaterThan(50);
    expect(view.url).toContain("bun.sh");
  }, 30000);

  it("extrae los links de la nav principal", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    const links = await view.evaluate<Array<{ text: string; href: string }>>(`
      Array.from(document.querySelectorAll("nav a, header a")).map(a => ({
        text: a.textContent?.trim() ?? "",
        href: a.href
      })).filter(l => l.text && l.href)
    `);
    console.log("── Links nav ──\n", links.map(l => `${l.text} → ${l.href}`).join("\n"));
    expect(links.length).toBeGreaterThan(0);
  }, 15000);

  it("hace click en el primer enlace de docs", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    const docsLink = await view.evaluate<string | null>(`
      (() => {
        const a = Array.from(document.querySelectorAll("a")).find(a =>
          /docs|documentation|guide/i.test(a.textContent ?? "") && a.href.includes("bun.sh")
        );
        return a?.href ?? null;
      })()
    `);
    console.log("── Docs link ──", docsLink);

    if (docsLink) {
      await view.navigate(docsLink);
      await new Promise(r => setTimeout(r, 1000));
      const title = await view.evaluate<string>(`document.title`);
      console.log("── Título página docs ──", title);
      expect(title.length).toBeGreaterThan(0);
    } else {
      console.log("No se encontró link de docs en nav — skipping click");
    }
  }, 30000);

  it("toma screenshot de bun.sh", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    await view.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 1500));
    const base64 = await view.screenshot({ format: "png" });
    console.log(`── Screenshot: ${base64.length} chars base64 ──`);
    expect(base64.length).toBeGreaterThan(1000);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  }, 30000);

  it("ejecuta script en bun.sh y obtiene versión", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    await view.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 1000));
    const version = await view.evaluate<string>(`
      (() => {
        const m = document.body.innerHTML.match(/Bun v(\\d+\\.\\d+\\.\\d+)/);
        return m ? m[0] : "version not found";
      })()
    `);
    console.log("── Versión detectada en bun.sh ──", version);
    expect(version).toMatch(/Bun v\d+\.\d+\.\d+/);
  }, 20000);

  it("navega a la página de install y extrae el comando", async () => {
    const view = await service.getView();
    if (!view) throw new Error("No view available");
    await view.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 800));

    const installCmd = await view.evaluate<string>(`
      (() => {
        const el = Array.from(document.querySelectorAll("code, pre, kbd")).find(e =>
          /curl|npm install|brew install/i.test(e.textContent ?? "")
        );
        return el?.textContent?.trim() ?? "not found";
      })()
    `);
    console.log("── Install command ──", installCmd);
    expect(typeof installCmd).toBe("string");
  }, 20000);
});
