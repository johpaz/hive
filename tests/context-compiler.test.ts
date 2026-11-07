/**
 * context-compiler tests: G9 causal context window (buildAgentContext).
 *
 * Exercises the real compileContext() path with a real (in-memory) HiveDB —
 * only the pieces that would otherwise need network/process I/O
 * (MCP manager, native tool executors) are left at their defaults since
 * createAllTools() works standalone in-process.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb, getHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import { addMessage, saveSummary } from "../packages/core/src/agent/conversation-store";
import { compileContext } from "../packages/core/src/agent/context-compiler";
import { storeProviderApiKey } from "../packages/core/src/storage/crypto";
import type { AgentDoc, ModelDoc, ProviderDoc, UserDoc } from "../packages/core/src/storage/collections";

async function seedAgentWithSmallContextWindow() {
  const usersCol = await col<UserDoc>("users");
  await usersCol.put("test-user", {
    id: "test-user",
    name: "Test User",
    language: "es",
    timezone: null,
    occupation: null,
    notes: null,
    master_key_hash: null,
    email: null,
    password_hash: null,
    preferred_cron_channel: "webchat",
    created_at: Date.now(),
  });

  const agentsCol = await col<AgentDoc>("agents");
  await agentsCol.put("test-agent", {
    id: "test-agent",
    user_id: "test-user",
    name: "Test Agent",
    description: null,
    system_prompt: "Eres un agente de prueba.",
    tone: null,
    role: "coordinator",
    status: "idle",
    enabled: true,
    provider_id: toIndexable("hiveagents"),
    model_id: toIndexable("test-model"),
    tools_json: null,
    skills_json: null,
    parent_id: toIndexable(null),
    max_iterations: 10,
    workspace: null,
    lastTraceAt: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const providersCol = await col<ProviderDoc>("providers");
  await providersCol.put("hiveagents", {
    id: "hiveagents",
    name: "HiveAgents",
    enabled: true,
    active: true,
    base_url: "https://fake.api.com/v1",
    category: "llm",
    num_ctx: null,
    num_gpu: 0,
    created_at: Date.now(),
  });

  // Small context window so a handful of messages is enough to cross
  // compactThreshold (window * 0.8) and force the summary/compaction path.
  const modelsCol = await col<ModelDoc>("models");
  await modelsCol.put("test-model", {
    id: "test-model",
    provider_id: "hiveagents",
    name: "Test Model",
    model_type: "llm",
    active: true,
    enabled: true,
    context_window: 1000,
    capabilities: null,
  });
}

// KEEP_LAST_N_MESSAGES in context-compiler.ts is 30 — insert enough messages
// that the recent-messages window is a strict suffix starting AFTER the
// summary's last_message_id. That's what makes a summary "apply": the window
// no longer reaches back far enough to cover what the summary already does.
async function forceCompaction(threadId: string) {
  for (let i = 0; i < 35; i++) {
    await addMessage(threadId, i % 2 === 0 ? "user" : "assistant", `msg-${i}`);
  }
  await saveSummary(threadId, "Resumen de la conversación previa.", 5, 5);
}

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  await seedAgentWithSmallContextWindow();
});

afterEach(() => {
  closeHiveDb();
  delete process.env.HIVE_CAUSAL_LOG;
  delete process.env.HIVE_HISTORY_TIMELINE;
  delete process.env.HIVE_HISTORY_TIMELINE_MIN_WINDOW;
  delete process.env.HIVE_HISTORY_TIMELINE_PARTS;
});

describe("context-compiler: G9 causal context window", () => {
  test("injects a # CAUSAL CONTEXT section once compaction fires and a causal stream has decisions", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    const streamId = "ctx-stream-1";
    const intentSeq = await db.append({
      agentId: "test-agent",
      streamId,
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "test-agent", intent: "deploy the checkout service" }),
    });
    await db.append({
      agentId: "test-agent",
      streamId,
      kind: "StateTransition",
      payload: JSON.stringify({ description: "Calling deploy_service on checkout" }),
      causation: intentSeq,
    });

    await forceCompaction("thread-ctx-1");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-ctx-1",
      userMessage: "Sigue con el deploy",
      causalStreamId: streamId,
    });

    expect(ctx.systemPrompt).toContain("# CAUSAL CONTEXT");
    expect(ctx.systemPrompt).toContain("Calling deploy_service on checkout");
  });

  test("does not inject a causal context section when causalLog is disabled", async () => {
    process.env.HIVE_CAUSAL_LOG = "false";
    const db = await getHiveDb();

    const streamId = "ctx-stream-2";
    const intentSeq = await db.append({
      agentId: "test-agent",
      streamId,
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "test-agent", intent: "deploy the checkout service" }),
    });
    await db.append({
      agentId: "test-agent",
      streamId,
      kind: "StateTransition",
      payload: JSON.stringify({ description: "Calling deploy_service on checkout" }),
      causation: intentSeq,
    });

    await forceCompaction("thread-ctx-2");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-ctx-2",
      userMessage: "Sigue con el deploy",
      causalStreamId: streamId,
    });

    expect(ctx.systemPrompt).not.toContain("# CAUSAL CONTEXT");
  });

  test("does not inject a causal context section when compaction hasn't fired", async () => {
    process.env.HIVE_CAUSAL_LOG = "true";
    const db = await getHiveDb();

    const streamId = "ctx-stream-3";
    const intentSeq = await db.append({
      agentId: "test-agent",
      streamId,
      kind: "IntentLogged",
      payload: JSON.stringify({ actor: "test-agent", intent: "deploy the checkout service" }),
    });
    await db.append({
      agentId: "test-agent",
      streamId,
      kind: "StateTransition",
      payload: JSON.stringify({ description: "Calling deploy_service on checkout" }),
      causation: intentSeq,
    });

    // No forceCompaction() call — conversation is short, no summary exists.

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-ctx-3",
      userMessage: "Hola",
      causalStreamId: streamId,
    });

    expect(ctx.systemPrompt).not.toContain("# CAUSAL CONTEXT");
  });
});

test("Jev keeps mandatory instructions and makes omitted history recoverable", async () => {
  const providers = await col<ProviderDoc>("providers");
  const openrouter = await providers.get("openrouter");
  await providers.put("openrouter", { ...openrouter!.doc, enabled: true, active: true }, { expectedVersion: openrouter!.version });
  await storeProviderApiKey("openrouter", "test-key");
  const history: Array<["user" | "assistant", string]> = [
    ["user", "Old unrelated detail"], ["assistant", "Old assistant reply"],
    ["user", "Previous request"], ["assistant", "Previous answer"],
    ["user", "Read my current file"], ["assistant", "I will read it"],
  ];
  for (const [role, content] of history) await addMessage("jev-context-thread", role, content);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => [id,
      (question as { type: string }).type === "choice"
        ? { type: "choice", choice: "coordinator", confidence: 0.9, probabilities: { coordinator: 0.9 } }
        : { type: "noul", noul: 0.01 },
    ]));
    return Response.json({ answers, usage: { input_tokens: 0, output_tokens: 0 } });
  }) as unknown as typeof fetch;
  try {
    const ctx = await compileContext({ agentId: "test-agent", threadId: "jev-context-thread", userId: "test-user", userMessage: "Read my current file" });
    // agent-loop publishes this to the office and the dashboard once it knows the model.
    expect(ctx.jevDecision?.summary).toContain("4/6 mensajes");
    // Tiny fixture: the estimate can round to either side of zero, but must be a number.
    expect(Number.isFinite(ctx.jevDecision!.savedTokens)).toBe(true);
    expect(ctx.messages.map(m => m.content)).toEqual(["Previous request", "Previous answer", "Read my current file", "I will read it"]);
    expect(ctx.systemPrompt).toContain("# ÉTICA Y REGLAS CONSTITUCIONALES");
    expect(ctx.systemPrompt).toContain("# CONTEXTO RECUPERABLE");
    expect(ctx.tools.some(t => t.function.name === "conversation_read")).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

describe("context-compiler: conversation summary + internal events", () => {
  test("folds the summary into systemPrompt as # RESUMEN DE LA CONVERSACIÓN when it applies", async () => {
    await forceCompaction("thread-summary-1");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-summary-1",
      userMessage: "Continuemos",
    });

    expect(ctx.systemPrompt).toContain("# RESUMEN DE LA CONVERSACIÓN");
    expect(ctx.systemPrompt).toContain("Resumen de la conversación previa.");
    expect(ctx.conversationSummarySection).not.toBe("");
  });

  test("does not include a summary section when none applies", async () => {
    await addMessage("thread-summary-2", "user", "Hola");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-summary-2",
      userMessage: "Hola de nuevo",
    });

    expect(ctx.systemPrompt).not.toContain("# RESUMEN DE LA CONVERSACIÓN");
    expect(ctx.conversationSummarySection).toBe("");
  });

  test("never emits a second role:system message in ctx.messages, even when a summary applies", async () => {
    await forceCompaction("thread-summary-3");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId: "thread-summary-3",
      userMessage: "Continuemos",
    });

    expect(ctx.messages.every((m) => m.role !== "system")).toBe(true);
  });

  test("an internal event keeps its chronological position and role:user in ctx.messages", async () => {
    const threadId = "thread-internal-1";
    await addMessage(threadId, "user", "Delega esto a un worker");
    await addMessage(threadId, "assistant", "Listo, delegado.");
    await addMessage(threadId, "user", "El agente completó la tarea X.", { source: "task_complete" });
    await addMessage(threadId, "assistant", "El worker terminó la tarea X exitosamente.");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId,
      userMessage: "¿Cómo va todo?",
    });

    expect(ctx.messages.every((m) => m.role !== "system")).toBe(true);

    const idx = ctx.messages.findIndex(
      (m) => typeof m.content === "string" && m.content.includes("hive:internal_event")
    );
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(ctx.messages.length - 1);
    expect(ctx.messages[idx].role).toBe("user");
  });
});

describe("context-compiler: recuperación de mensajes fuera de la ventana (sin modelo)", () => {
  /** El indexado al guardar va en segundo plano; se espera a que el dato plantado sea buscable. */
  async function esperarIndice(threadId: string, consulta: string) {
    const { searchThreadMessages } = await import("../packages/core/src/agent/message-memory");
    const fin = Date.now() + 3000;
    while (Date.now() < fin) {
      if ((await searchThreadMessages(threadId, consulta)).length > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  test("inyecta el mensaje antiguo relevante aunque no haya resumen", async () => {
    const threadId = "thread-recall-1";
    await addMessage(threadId, "user", "La contraseña del servidor de respaldo es CLAVE-77-OMEGA, guárdala");
    for (let i = 0; i < 30; i++) {
      await addMessage(threadId, i % 2 === 0 ? "assistant" : "user", `charla de relleno número ${i} sobre otro tema distinto`);
    }
    await esperarIndice(threadId, "contraseña servidor respaldo");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId,
      userMessage: "¿Cuál era la contraseña del servidor de respaldo?",
    });

    expect(ctx.systemPrompt).toContain("# HISTORIAL FUERA DE VENTANA");
    expect(ctx.systemPrompt).toContain("# MENSAJES ANTERIORES RELEVANTES");
    expect(ctx.systemPrompt).toContain("CLAVE-77-OMEGA");
    expect(ctx.messages.every((m) => m.role !== "system")).toBe(true);
  });

  test("un hilo corto no inyecta nada", async () => {
    const threadId = "thread-recall-2";
    await addMessage(threadId, "user", "La contraseña del servidor de respaldo es CLAVE-77-OMEGA, guárdala");
    await esperarIndice(threadId, "contraseña servidor respaldo");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId,
      userMessage: "¿Cuál era la contraseña del servidor de respaldo?",
    });

    expect(ctx.systemPrompt).not.toContain("# HISTORIAL FUERA DE VENTANA");
    expect(ctx.systemPrompt).not.toContain("# MENSAJES ANTERIORES RELEVANTES");
  });

  test("no repite lo que ya está dentro de la ventana", async () => {
    const threadId = "thread-recall-3";
    for (let i = 0; i < 30; i++) {
      await addMessage(threadId, i % 2 === 0 ? "user" : "assistant", `charla de relleno número ${i} sobre otro tema distinto`);
    }
    await addMessage(threadId, "user", "El código de la bodega norte es BOD-NORTE-5521, anótalo");
    await esperarIndice(threadId, "código bodega norte");

    const ctx = await compileContext({
      agentId: "test-agent",
      threadId,
      userMessage: "¿Cuál es el código de la bodega norte?",
    });

    expect(ctx.systemPrompt).not.toContain("# MENSAJES ANTERIORES RELEVANTES");
  });
});

describe("context-compiler: línea de tiempo del historial (HIVE_HISTORY_TIMELINE)", () => {
  /** Cambia la ventana del modelo sembrado (el resto de tests usa 1000 para forzar la compactación). */
  async function setContextWindow(contextWindow: number) {
    const modelsCol = await col<ModelDoc>("models");
    const entry = await modelsCol.get("test-model");
    await modelsCol.put("test-model", { ...entry!.doc, context_window: contextWindow });
  }

  /** 60 mensajes; el dato exacto va en el #5, bien fuera de la ventana de 15. */
  async function longThread(threadId: string) {
    for (let i = 1; i <= 60; i++) {
      const content = i === 5
        ? "El número de pedido es PED-48213 y la ruta /srv/app/config/prod-7731.yaml"
        : `mensaje de relleno número ${i} sin nada especial que recordar`;
      await addMessage(threadId, i % 2 ? "user" : "assistant", content);
    }
  }

  test("con el flag encendido inyecta la línea de tiempo con los mensajes fuera de ventana", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    await setContextWindow(32_000);
    await longThread("thread-ht-1");
    const ctx = await compileContext({ agentId: "test-agent", threadId: "thread-ht-1", userMessage: "dime el número de pedido" });
    expect(ctx.systemPrompt).toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
    expect(ctx.systemPrompt).toContain("#5 [user]");
  });

  test("con el flag apagado no hay línea de tiempo", async () => {
    await setContextWindow(32_000);
    await longThread("thread-ht-2");
    const ctx = await compileContext({ agentId: "test-agent", threadId: "thread-ht-2", userMessage: "dime el número de pedido" });
    expect(ctx.systemPrompt).not.toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });

  test("con el flag encendido pero una ventana menor que el mínimo, se ignora", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    await setContextWindow(8_000);
    await longThread("thread-ht-4");
    const ctx = await compileContext({ agentId: "test-agent", threadId: "thread-ht-4", userMessage: "dime el número de pedido" });
    expect(ctx.systemPrompt).not.toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });

  test("HIVE_HISTORY_TIMELINE_MIN_WINDOW=0 quita la compuerta", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    process.env.HIVE_HISTORY_TIMELINE_MIN_WINDOW = "0";
    await setContextWindow(8_000);
    await longThread("thread-ht-5");
    const ctx = await compileContext({ agentId: "test-agent", threadId: "thread-ht-5", userMessage: "dime el número de pedido" });
    expect(ctx.systemPrompt).toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });

  test("el umbral por defecto es 16 000: justo en el umbral actúa, un token por debajo no", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    await setContextWindow(16_000);
    await longThread("thread-ht-6");
    const on = await compileContext({ agentId: "test-agent", threadId: "thread-ht-6", userMessage: "dime el número de pedido" });
    expect(on.systemPrompt).toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");

    await setContextWindow(15_999);
    await longThread("thread-ht-7");
    const off = await compileContext({ agentId: "test-agent", threadId: "thread-ht-7", userMessage: "dime el número de pedido" });
    expect(off.systemPrompt).not.toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });

  test("HIVE_HISTORY_TIMELINE_PARTS: recall no pone línea de tiempo y timeline sí", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    await setContextWindow(32_000);
    process.env.HIVE_HISTORY_TIMELINE_PARTS = "recall";
    await longThread("thread-ht-8");
    const recall = await compileContext({ agentId: "test-agent", threadId: "thread-ht-8", userMessage: "dime el número de pedido" });
    expect(recall.systemPrompt).not.toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");

    process.env.HIVE_HISTORY_TIMELINE_PARTS = "timeline";
    const timeline = await compileContext({ agentId: "test-agent", threadId: "thread-ht-8", userMessage: "dime el número de pedido" });
    expect(timeline.systemPrompt).toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });

  test("un hilo que cabe en la ventana no genera línea de tiempo", async () => {
    process.env.HIVE_HISTORY_TIMELINE = "true";
    await setContextWindow(32_000);
    for (let i = 1; i <= 6; i++) await addMessage("thread-ht-3", i % 2 ? "user" : "assistant", `mensaje corto número ${i} de prueba`);
    const ctx = await compileContext({ agentId: "test-agent", threadId: "thread-ht-3", userMessage: "hola de nuevo" });
    expect(ctx.systemPrompt).not.toContain("# LÍNEA DE TIEMPO DE LA CONVERSACIÓN");
  });
});
