/**
 * Obscura (headless browser) driven through its MCP server, against a local
 * page. Skipped when the binary is not installed. Chrome is not involved.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createObscuraTools, obscuraAvailable, closeObscura } from "../packages/core/src/tools/web/obscura";

const tools = new Map(createObscuraTools().map((t) => [t.name, t]));
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await tools.get(name)!.execute(args)) as Record<string, any>;

const PAGE = `<!doctype html><html><head><title>Hive Obscura</title></head><body>
<h1 id="t">Hola Obscura</h1>
<a href="/dos">Segunda</a>
<form><input id="n" name="n" placeholder="nombre"><button id="b" type="button" onclick="document.getElementById('t').textContent='Enviado '+document.getElementById('n').value">Enviar</button></form>
</body></html>`;

describe("herramientas obscura_*", () => {
  test("los nombres no chocan con las browser_* de Chrome", () => {
    expect(tools.size).toBe(37);
    for (const name of tools.keys()) expect(name.startsWith("obscura_")).toBe(true);
  });

  test("sin el binario devuelven un error claro", async () => {
    if (obscuraAvailable()) return;
    const r = await call("obscura_navigate", { url: "http://localhost" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not installed");
  });
});

describe.skipIf(!obscuraAvailable())("sesión real de Obscura", () => {
  let server: ReturnType<typeof Bun.serve>;
  let url: string;

  beforeAll(() => {
    process.env.OBSCURA_ALLOW_PRIVATE_NETWORK = "1"; // el servidor es localhost
    server = Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }) });
    url = `http://localhost:${server.port}/`;
  });

  afterAll(async () => {
    await closeObscura();
    server.stop(true);
  });

  test("navega, lee, rellena y hace clic", async () => {
    const nav = await call("obscura_navigate", { url });
    expect(nav.ok).toBe(true);
    expect(nav.text).toContain("Hive Obscura");

    const snap = await call("obscura_snapshot");
    expect(snap.ok).toBe(true);
    expect(snap.text).toContain("Hola Obscura");
    expect(snap.text).toContain("Enviar");

    expect((await call("obscura_links")).text).toContain("Segunda");

    expect((await call("obscura_fill", { selector: "#n", value: "Ana" })).ok).toBe(true);
    expect((await call("obscura_click", { selector: "#b" })).ok).toBe(true);
    const out = await call("obscura_evaluate", { expression: "document.getElementById('t').textContent" });
    expect(out.text).toContain("Enviado Ana");
  });

  test("rechaza una herramienta que el servidor no conoce sin colgarse", async () => {
    const r = await call("obscura_wait_for", { selector: "#no-existe", timeout: 1, timeoutMs: 8000 });
    expect(r.ok).toBe(false);
  });
});
