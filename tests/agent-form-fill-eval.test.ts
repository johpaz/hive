/**
 * Agent Form-Fill Eval — GoFest 2026 mock
 *
 * Test end-to-end REAL contra un servidor local:
 *   - Usa el agente coordinador real de la DB.
 *   - Usa el LLM real configurado para el coordinador.
 *   - Usa Chrome/CDP real vía agent-browser.
 *   - Verifica que el agente llame las tools de browser correctamente,
 *     mantenga el contexto de la tarea y no se atasque.
 *
 * No envía el formulario a ningún sitio externo.
 *
 * Correr:
 *   export OPENAI_API_KEY=...   # o la key del provider del coordinador
 *   export BROWSER_TESTS=1
 *   export AGENT_FORM_EVAL=1
 *   bun test tests/agent-form-fill-eval.test.ts --timeout 180000
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { getHiveDbPath } from "../packages/core/src/storage/hivedb";
import {
  resolveAgentId,
  activateBrowserTools,
} from "../packages/core/src/storage/onboarding";
import {
  initializeBrowserService,
  getBrowserService,
} from "../packages/core/src/tools/web/browser-service";
import { buildAgentLoop, getAgentLoop } from "../packages/core/src/agent/agent-loop";
import { loadConfig } from "../packages/core/src/config/loader";
import { compileContext } from "../packages/core/src/agent/context-compiler";
import {
  browserNavigateTool,
  browserTypeTool,
  browserClickTool,
  browserExtractTool,
  browserWaitTool,
  browserScriptTool,
  browserScreenshotTool,
} from "../packages/core/src/tools/web/index";

// ─── Gate ─────────────────────────────────────────────────────────────────────

const RUN = process.env.AGENT_FORM_EVAL === "1";

// Force browser tools into the LLM loadout so the test doesn't depend on the
// model calling search_knowledge first.
const BROWSER_TOOL_DEFINITIONS = [
  browserNavigateTool,
  browserTypeTool,
  browserClickTool,
  browserExtractTool,
  browserWaitTool,
  browserScriptTool,
  browserScreenshotTool,
].map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)("Agent form-fill eval — GoFest mock", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(async () => {
    const dbPath = getHiveDbPath();
    if (!existsSync(dbPath)) {
      throw new Error(`Hive DB not found at ${dbPath}. Complete onboarding first.`);
    }

    await ensureHiveDb();
    await activateBrowserTools();

    const config = loadConfig();
    initializeBrowserService(config);
    const browserStarted = await getBrowserService()?.start();
    if (!browserStarted) {
      throw new Error("Browser service could not start. Is agent-browser installed?");
    }

    buildAgentLoop({ mcpManager: null });
    const agentLoop = getAgentLoop();
    if (!agentLoop) throw new Error("AgentLoop could not be built");

    const coordinatorId = await resolveAgentId(null);
    if (!coordinatorId) throw new Error("No coordinator agent found in DB");

    // Sanity-check: browser tools must exist in the registry
    const ctx = await compileContext({
      agentId: coordinatorId,
      threadId: "agent-form-eval-sanity",
      userMessage: "fill the gofest registration form",
    });
    const allToolNames = ctx.allTools.map((t: any) => t.name);
    const hasBrowserTools =
      allToolNames.includes("browser_navigate") && allToolNames.includes("browser_type");
    if (!hasBrowserTools) {
      throw new Error(
        `Browser tools not registered. Found: ${allToolNames.join(", ")}`
      );
    }

    const html = readFileSync(
      join(import.meta.dir, "fixtures", "gofest-form.html"),
      "utf-8"
    );
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/" || path === "") {
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response("404", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${(server as any).port}`;
    console.log(`\n🧪 Local form server: ${baseUrl}\n`);
  });

  afterAll(async () => {
    await getBrowserService()?.dispose();
    server?.stop();
  });

  it("navega, llena campos del formulario y responde sin atascarse", async () => {
    const coordinatorId = (await resolveAgentId(null))!;
    const threadId = `agent-form-eval-${Date.now()}`;
    const userMessage =
      `Llena el formulario de registro para llevar a Hive Agents a GoFest 2026. ` +
      `Instrucciones obligatorias: 1) Abre la página con browser_navigate. ` +
      `2) Completa todos los campos con browser_type (texto), browser_click para país y tipo de participación. ` +
      `3) Haz click en el botón Enviar para dejar el formulario listo. ` +
      `4) NO tomes screenshots innecesarios; solo inspecciona una vez si es necesario. ` +
      `5) Responde al confirmar que el formulario está listo. URL: ${baseUrl}/`;

    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const stuckEvents: string[] = [];
    let finalContent = "";
    let finalToolCalls: typeof toolCalls = [];

    const agentLoop = getAgentLoop()!;
    const stream = agentLoop.stream(
      { messages: [{ role: "user", content: userMessage }] },
      {
        configurable: {
          thread_id: threadId,
          agent_id: coordinatorId,
          raw_user_message: userMessage,
        },
        extraTools: BROWSER_TOOL_DEFINITIONS,
        onStep: async (step) => {
          if (step.type === "tool_call" && step.toolName) {
            console.log(`🔧 ${step.toolName}`);
          }
          if (step.type === "tool_result" && step.message) {
            const msg = step.message;
            if (
              msg.includes("Stuck loop detected") ||
              msg.includes("CRITICAL") ||
              msg.includes("WARNING: Has llamado") ||
              msg.includes("Has estado sin avanzar")
            ) {
              stuckEvents.push(msg.substring(0, 200));
            }
          }
        },
      }
    );

    const consume = async () => {
      for await (const chunk of stream) {
        if (chunk.agent?.messages?.[0]) {
          const msg = chunk.agent.messages[0];
          if (msg.content && typeof msg.content === "string") {
            finalContent = msg.content;
          }
          if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
              const name = tc.function?.name || tc.name || "unknown";
              const args =
                typeof tc.function?.arguments === "string"
                  ? JSON.parse(tc.function.arguments)
                  : tc.function?.arguments || tc.args || {};
              toolCalls.push({ name, args });
            }
          }
        }
      }
      finalToolCalls = toolCalls;
    };

    await runWithTimeout(consume(), 120_000, "agent form-fill stream");

    console.log("\n📊 Resumen de tool calls:");
    for (const tc of finalToolCalls) {
      const argsSummary = Object.entries(tc.args)
        .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`)
        .join(" ");
      console.log(`   - ${tc.name}: ${argsSummary}`);
    }
    console.log(`\n📝 Respuesta final:\n${finalContent.slice(0, 500)}\n`);

    // ── Assertions ─────────────────────────────────────────────────────────

    // 1. Navegación correcta
    const navigations = finalToolCalls.filter(
      (tc) => tc.name === "browser_navigate" && tc.args.url === baseUrl + "/"
    );
    expect(navigations.length).toBeGreaterThanOrEqual(1);

    // 2. Llenado de campos
    const typeCalls = finalToolCalls.filter((tc) => tc.name === "browser_type");
    const filledSelectors = new Set(typeCalls.map((tc) => tc.args.selector as string));
    expect(typeCalls.length).toBeGreaterThanOrEqual(4);
    expect(filledSelectors.size).toBeGreaterThanOrEqual(3);

    // 3. Contexto de la tarea mantenido
    const contextKeywords = ["gofest", "formulario", "hive", "registro", "campos"];
    const contentLower = finalContent.toLowerCase();
    const hasContext = contextKeywords.some((kw) => contentLower.includes(kw));
    expect(hasContext).toBe(true);

    // 4. No se atascó
    expect(stuckEvents.length).toBe(0);

    // 5. Verificar valores reales en el DOM
    const view = await getBrowserService()?.getView();
    expect(view).toBeTruthy();

    // Leemos los valores actuales de los inputs. Esto es más robusto que depender
    // de que el evento submit se dispare correctamente en el browser automation.
    const fieldValues = await view!.evaluate<{
      fullname: string;
      email: string;
      company: string;
      country: string;
      role: string | null;
      proposal: string;
      status: string;
      saved: boolean;
    }>(`
      (() => {
        const fullname = document.getElementById('fullname')?.value || '';
        const email = document.getElementById('email')?.value || '';
        const company = document.getElementById('company')?.value || '';
        const country = document.getElementById('country')?.value || '';
        const role = document.querySelector('input[name="role"]:checked')?.value || null;
        const proposal = document.getElementById('proposal')?.value || '';
        const status = document.getElementById('status-message')?.textContent || '';
        const saved = !!(window.__hiveFormData && window.__hiveFormData.fullname);
        return { fullname, email, company, country, role, proposal, status, saved };
      })()
    `);

    console.log("🧾 Valores guardados por el formulario:", fieldValues);

    expect(fieldValues.fullname.length).toBeGreaterThan(2);
    expect(fieldValues.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(fieldValues.company.length).toBeGreaterThan(1);
    expect(fieldValues.country).not.toBe("");
    expect(fieldValues.role).toBeTruthy();
    expect(fieldValues.proposal.length).toBeGreaterThan(10);
    // El formulario fue marcado como listo (submit disparado) O al menos los campos están llenos.
    expect(fieldValues.status.toLowerCase().includes("listo para enviar") || fieldValues.saved).toBe(true);
  });

  it("no se queda colgado cuando la página no tiene formulario", async () => {
    // Variante forzada: la URL no tiene campos de formulario. El agente no debe
    // quedarse en bucle infinito; debe responder al usuario o ser detenido por
    // max iterations / wall-clock timeout / stall detection.
    const brokenServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html><body><h1>Formulario roto</h1></body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    });
    const brokenUrl = `http://localhost:${(brokenServer as any).port}`;

    try {
      const coordinatorId = (await resolveAgentId(null))!;
      const threadId = `agent-form-eval-broken-${Date.now()}`;
      const userMessage = `Llena este formulario para GoFest 2026: ${brokenUrl}/`;

      const toolCalls: Array<{ name: string }> = [];
      let finalContent = "";

      const agentLoop = getAgentLoop()!;
      const stream = agentLoop.stream(
        { messages: [{ role: "user", content: userMessage }] },
        {
          configurable: {
            thread_id: threadId,
            agent_id: coordinatorId,
            raw_user_message: userMessage,
          },
          extraTools: BROWSER_TOOL_DEFINITIONS,
          onStep: async (step) => {
            if (step.type === "tool_call" && step.toolName) {
              toolCalls.push({ name: step.toolName });
            }
          },
        }
      );

      const consume = async () => {
        for await (const chunk of stream) {
          if (chunk.agent?.messages?.[0]?.content) {
            finalContent = chunk.agent.messages[0].content;
          }
          if (chunk.agent?.messages?.[0]?.tool_calls) {
            for (const tc of chunk.agent.messages[0].tool_calls) {
              toolCalls.push({ name: tc.function?.name || tc.name || "unknown" });
            }
          }
        }
      };

      await runWithTimeout(consume(), 60_000, "broken-form stream");

      console.log("\n🔥 Test anti-atasco:");
      console.log(`   Tools: ${toolCalls.map((t) => t.name).join(", ")}`);
      console.log(`   Final length: ${finalContent.length}`);
      console.log(`   Final: ${finalContent.slice(0, 200)}`);

      // Navegó al sitio
      expect(toolCalls.some((t) => t.name === "browser_navigate")).toBe(true);
      // No se quedó colgado: retornó contenido final dentro del timeout
      expect(finalContent.length).toBeGreaterThan(20);
    } finally {
      brokenServer.stop();
    }
  });
});
