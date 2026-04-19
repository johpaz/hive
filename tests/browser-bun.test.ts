/**
 * Real browser test: navegación por bun.sh
 * Requiere: BROWSER_TESTS=1
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { CDPClient, detectBrowser } from "../packages/core/src/tools/web/browser-service.ts";

const BROWSER_TESTS = process.env.BROWSER_TESTS === "1";

describe.skipIf(!BROWSER_TESTS)("bun.sh — navegación real", () => {
  let client: CDPClient;

  beforeAll(async () => {
    const spec = detectBrowser();
    if (!spec) throw new Error("No browser found");
    client = new CDPClient();
    await client.launch(spec);
  }, 30000);

  afterAll(() => {
    client?.close();
  });

  it("navega a bun.sh y obtiene contenido", async () => {
    await client.navigate("https://bun.sh");
    const text = await client.evaluate<string>(`
      (() => {
        document.querySelectorAll("script,style,noscript").forEach(e => e.remove());
        return document.body?.innerText?.slice(0, 500) ?? "";
      })()
    `);
    console.log("── Contenido bun.sh ──\n", text.slice(0, 300));
    expect(text.length).toBeGreaterThan(50);
    expect(client.url).toContain("bun.sh");
  }, 30000);

  it("extrae los links de la nav principal", async () => {
    const links = await client.evaluate<Array<{ text: string; href: string }>>(`
      Array.from(document.querySelectorAll("nav a, header a")).map(a => ({
        text: a.textContent?.trim() ?? "",
        href: a.href
      })).filter(l => l.text && l.href)
    `);
    console.log("── Links nav ──\n", links.map(l => `${l.text} → ${l.href}`).join("\n"));
    expect(links.length).toBeGreaterThan(0);
  }, 15000);

  it("hace click en el primer enlace de docs", async () => {
    const docsLink = await client.evaluate<string | null>(`
      (() => {
        const a = Array.from(document.querySelectorAll("a")).find(a =>
          /docs|documentation|guide/i.test(a.textContent ?? "") && a.href.includes("bun.sh")
        );
        return a?.href ?? null;
      })()
    `);
    console.log("── Docs link ──", docsLink);

    if (docsLink) {
      await client.navigate(docsLink);
      await new Promise(r => setTimeout(r, 1000));
      const title = await client.evaluate<string>(`document.title`);
      console.log("── Título página docs ──", title);
      expect(title.length).toBeGreaterThan(0);
    } else {
      console.log("No se encontró link de docs en nav — skipping click");
    }
  }, 30000);

  it("toma screenshot de bun.sh", async () => {
    await client.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 1500));
    const base64 = await client.screenshot({ format: "png" });
    console.log(`── Screenshot: ${base64.length} chars base64 ──`);
    expect(base64.length).toBeGreaterThan(1000);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  }, 30000);

  it("ejecuta script en bun.sh y obtiene versión", async () => {
    await client.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 1000));
    const version = await client.evaluate<string>(`
      (() => {
        const m = document.body.innerHTML.match(/Bun v(\\d+\\.\\d+\\.\\d+)/);
        return m ? m[0] : "version not found";
      })()
    `);
    console.log("── Versión detectada en bun.sh ──", version);
    expect(version).toMatch(/Bun v\d+\.\d+\.\d+/);
  }, 20000);

  it("navega a la página de install y extrae el comando", async () => {
    await client.navigate("https://bun.sh");
    await new Promise(r => setTimeout(r, 800));

    const installCmd = await client.evaluate<string>(`
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
