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
      userMessage: "Seguí con el deploy",
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
      userMessage: "Seguí con el deploy",
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
    await addMessage(threadId, "user", "Delegá esto a un worker");
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
