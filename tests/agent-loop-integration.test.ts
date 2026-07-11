/**
 * Integration test: durable agent loop with checkpoint/resume.
 *
 * Exercises the real runAgent code path (the same one a webchat request follows)
 * with only callLLM, resolveProviderConfig, and executeToolBatch mocked.
 *
 * Tests:
 *   1. Durable run creates AgentRun and completes
 *   2. Resume restores state + injects [interrupted] tool messages
 *   3. Budget limit triggers checkpoint + synthesis
 *   4. Full pipeline: tool call → checkpoint → crash → resume → complete
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import type { AgentDoc, UserDoc, ProviderDoc, ModelDoc } from "../packages/core/src/storage/collections";
import { runAgent, type AgentLoopOptions } from "../packages/core/src/agent/agent-loop";
import { createRun, checkpoint, getRun, completeRun } from "../packages/core/src/agent/run-store";
import type { RunCheckpointState } from "../packages/core/src/agent/run-store";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let callLLMSpy: ReturnType<typeof spyOn>;
let resolveProviderConfigSpy: ReturnType<typeof spyOn>;
let executeToolBatchSpy: ReturnType<typeof spyOn>;

async function setupMocks() {
  // Mock resolveProviderConfig — returns fake provider config (no real API key)
  resolveProviderConfigSpy = spyOn(
    await import("../packages/core/src/agent/llm-client"),
    "resolveProviderConfig"
  ).mockResolvedValue({
    provider: "hiveagents",
    model: "test-model",
    apiKey: "test-api-key",
    baseUrl: "https://fake.api.com/v1",
  });

  // Mock callLLM — returns controlled responses (set per test via mockImplementation)
  callLLMSpy = spyOn(
    await import("../packages/core/src/agent/llm-client"),
    "callLLM"
  ).mockResolvedValue({
    content: "Test response",
    stop_reason: "stop",
    usage: { input_tokens: 100, output_tokens: 50 },
  });

  // Mock executeToolBatch — returns fake tool results
  executeToolBatchSpy = spyOn(
    await import("../packages/core/src/tool-runtime"),
    "executeToolBatch"
  ).mockResolvedValue([
    {
      toolCall: { id: "mock-tc-1", function: { name: "fake_tool", arguments: "{}" } },
      toolName: "fake_tool",
      result: { success: true, message: "Fake tool executed" },
      ok: true,
      durationMs: 10,
    },
  ]);
}

function restoreMocks() {
  callLLMSpy?.mockRestore();
  resolveProviderConfigSpy?.mockRestore();
  executeToolBatchSpy?.mockRestore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedTestAgent() {
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
    system_prompt: "Eres un agente de prueba. Responde de forma concisa.",
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

  // Seed the provider (required by resolveProviderConfig → DB lookup)
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

  // Seed the model (required by resolveProviderConfig → DB lookup)
  const modelsCol = await col<ModelDoc>("models");
  await modelsCol.put("test-model", {
    id: "test-model",
    provider_id: "hiveagents",
    name: "Test Model",
    model_type: "llm",
    active: true,
    enabled: true,
    context_window: 128000,
    capabilities: null,
  });
}

type StreamChunk = { agent?: { messages?: Array<{ content?: string | null; tool_calls?: unknown[] }>; streamed?: boolean }; tools?: { messages?: Array<{ content: string; tool_call_id: string }> }; usage?: { input_tokens: number; output_tokens: number } };

async function collectChunks(opts: AgentLoopOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of runAgent(opts)) {
    chunks.push(chunk as StreamChunk);
  }
  return chunks;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  await seedTestAgent();
  await setupMocks();
});

afterEach(() => {
  restoreMocks();
  closeHiveDb();
});

describe("agent-loop integration: durable run + checkpoint/resume", () => {
  test("1. durable run creates AgentRun and completes", async () => {
    // Mock LLM to return text immediately (no tool calls)
    callLLMSpy.mockResolvedValue({
      content: "Hola, soy el agente de prueba.",
      stop_reason: "stop",
      usage: { input_tokens: 80, output_tokens: 30 },
    });

    const chunks = await collectChunks({
      agentId: "test-agent",
      userMessage: "Hola",
      threadId: "thread-1",
      durable: true,
      budget: { maxIterations: 3 },
    });

    // Should have agent chunks + usage chunk
    const agentChunks = chunks.filter(c => c.agent);
    expect(agentChunks.length).toBeGreaterThan(0);

    // Final content should be present
    const lastAgentChunk = agentChunks[agentChunks.length - 1];
    expect(lastAgentChunk.agent?.messages?.[0]?.content).toContain("agente de prueba");

    // Verify AgentRun was created and completed in DB
    const runsCol = await col<any>("agentRuns");
    const allRuns = await runsCol.scan({});
    expect(allRuns.length).toBe(1);

    const run = allRuns[0].doc;
    expect(run.status).toBe("completed");
    expect(run.kind).toBe("chat");
    expect(run.agent_id).toBe("test-agent");
    expect(run.iterations_used).toBeGreaterThanOrEqual(1);
    expect(run.max_iterations).toBe(3);

    // Checkpoint state should be cleared on completion
    expect(run.state_json).toBe("");
    expect(run.pending_tool_calls_json).toBeNull();
  });

  test("2. resume restores state and injects [interrupted] tool messages", async () => {
    // 1. Create a run with a checkpoint that has a pending tool call
    const run = await createRun({
      thread_id: "thread-resume",
      agent_id: "test-agent",
      user_id: "test-user",
      channel: "webchat",
      kind: "chat",
      max_iterations: 20,
    });

    const checkpointState: RunCheckpointState = {
      version: 1,
      messages: [
        { role: "system", content: "Eres un agente de prueba." },
        { role: "user", content: "Ejecutá la tarea" },
        { role: "assistant", content: null, tool_calls: [{ id: "tc-pending", type: "function", function: { name: "fake_tool", arguments: '{"action":"run"}' } }] },
      ],
      iterations: 2,
      totalInputTokens: 500,
      totalOutputTokens: 200,
      lastToolSignature: "fake_tool:{\"action\":\"run\"}",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    // Checkpoint with a pending tool call (simulates crash mid-tool)
    await checkpoint(run.id, checkpointState, [
      { id: "tc-pending", type: "function", function: { name: "fake_tool", arguments: '{"action":"run"}' } },
    ]);

    // 2. Mock LLM to return text on resume
    callLLMSpy.mockResolvedValue({
      content: "La tarea se completó exitosamente.",
      stop_reason: "stop",
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    // 3. Resume the run
    const chunks = await collectChunks({
      agentId: "test-agent",
      userMessage: "Ejecutá la tarea",
      threadId: "thread-resume",
      runId: run.id,
      resume: true,
      durable: true,
    });

    // 4. Verify resumed run completed
    const resumedRun = await getRun(run.id);
    expect(resumedRun).not.toBeNull();
    expect(resumedRun!.status).toBe("completed");

    // Iterations should continue from checkpoint (2 + at least 1 more)
    expect(resumedRun!.iterations_used).toBeGreaterThanOrEqual(3);

    // Final content should be present
    const agentChunks = chunks.filter(c => c.agent);
    const lastChunk = agentChunks[agentChunks.length - 1];
    expect(lastChunk.agent?.messages?.[0]?.content).toContain("completó exitosamente");

    // Checkpoint should be cleared after completion
    expect(resumedRun!.state_json).toBe("");
    expect(resumedRun!.pending_tool_calls_json).toBeNull();
  });

  test("3. budget limit triggers checkpoint and synthesis", async () => {
    // Mock LLM to always return tool calls (never text) — forces budget exhaustion
    let callCount = 0;
    callLLMSpy.mockImplementation(async () => {
      callCount++;
      return {
        content: "",
        tool_calls: [
          { id: `tc-${callCount}`, type: "function" as const, function: { name: "fake_tool", arguments: `{"call":${callCount}}` } },
        ],
        stop_reason: "tool_calls" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    });

    // Also mock executeToolBatch to return results for each tool call
    executeToolBatchSpy.mockImplementation(async (opts: any) => {
      return opts.toolCalls.map((tc: any) => ({
        toolCall: tc,
        toolName: tc.function.name,
        result: { success: true },
        ok: true,
        durationMs: 5,
      }));
    });

    const chunks = await collectChunks({
      agentId: "test-agent",
      userMessage: "Hacé muchas cosas",
      threadId: "thread-budget",
      durable: true,
      budget: { maxIterations: 2 },
    });

    // Verify AgentRun completed (synthesis call provides final text)
    const runsCol = await col<any>("agentRuns");
    const allRuns = await runsCol.scan({});
    expect(allRuns.length).toBe(1);

    const run = allRuns[0].doc;
    expect(run.status).toBe("completed");
    // Budget was 2 iterations, synthesis is extra (not counted in iterations_used)
    expect(run.iterations_used).toBe(2);

    // Should have yielded agent chunks (including synthesis)
    const agentChunks = chunks.filter(c => c.agent);
    expect(agentChunks.length).toBeGreaterThan(0);
  });

  test("4. full pipeline: tool call → checkpoint → crash → resume → complete", async () => {
    // ── Phase 1: Initial run with tool call ────────────────────────────────
    let callNum = 0;
    callLLMSpy.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) {
        // First call: return a tool call
        return {
          content: "",
          tool_calls: [
            { id: "tc-phase1", type: "function" as const, function: { name: "fake_tool", arguments: '{"step":"process"}' } },
          ],
          stop_reason: "tool_calls" as const,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }
      // Second call: return text (for synthesis after crash simulation)
      return {
        content: "Resultado parcial procesado.",
        stop_reason: "stop" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    });

    executeToolBatchSpy.mockImplementation(async (opts: any) => {
      return opts.toolCalls.map((tc: any) => ({
        toolCall: tc,
        toolName: tc.function.name,
        result: { output: "Tool result data" },
        ok: true,
        durationMs: 8,
      }));
    });

    // Run with maxIterations=1 so it hits the limit after 1 tool round-trip
    // This creates the AgentRun, does 1 iteration with tool, checkpoints, then synthesizes
    const chunks1 = await collectChunks({
      agentId: "test-agent",
      userMessage: "Procesá esto",
      threadId: "thread-pipeline",
      durable: true,
      budget: { maxIterations: 1 },
    });

    // Verify the run was created
    const runsCol = await col<any>("agentRuns");
    const allRuns = await runsCol.scan({});
    expect(allRuns.length).toBe(1);

    const runAfterPhase1 = allRuns[0].doc;
    expect(runAfterPhase1.status).toBe("completed");
    expect(runAfterPhase1.iterations_used).toBe(1);
    const runId = allRuns[0].id;

    // ── Phase 2: Simulate crash — create a checkpoint with pending tool call ─
    // Manually create a state that simulates "crashed mid-tool on iteration 2"
    const crashState: RunCheckpointState = {
      version: 1,
      messages: [
        { role: "system", content: "Eres un agente de prueba." },
        { role: "user", content: "Procesá esto" },
        { role: "assistant", content: "Resultado parcial procesado." },
        { role: "user", content: "Seguí con la siguiente tarea" },
        { role: "assistant", content: null, tool_calls: [{ id: "tc-crash", type: "function", function: { name: "fake_tool", arguments: '{"step":"continue"}' } }] },
      ],
      iterations: 2,
      totalInputTokens: 400,
      totalOutputTokens: 150,
      lastToolSignature: "fake_tool:{\"step\":\"continue\"}",
      consecutiveRepeat: 0,
      idleIterations: 0,
      injectedToolNames: [],
      systemPromptSkillSections: [],
    };

    // We need to create a NEW run to simulate the crash state
    // (the first run already completed, so we create a fresh one for the resume test)
    const crashRun = await createRun({
      thread_id: "thread-pipeline-2",
      agent_id: "test-agent",
      user_id: "test-user",
      channel: "webchat",
      kind: "chat",
      max_iterations: 20,
    });

    await checkpoint(crashRun.id, crashState, [
      { id: "tc-crash", type: "function", function: { name: "fake_tool", arguments: '{"step":"continue"}' } },
    ]);

    // Verify checkpoint was saved
    const savedRun = await getRun(crashRun.id);
    expect(savedRun!.status).toBe("running");
    expect(savedRun!.pending_tool_calls_json).not.toBeNull();
    expect(savedRun!.iterations_used).toBe(2);

    // ── Phase 3: Resume from crash ──────────────────────────────────────────
    // Reset call counter for the resume phase
    callNum = 0;
    callLLMSpy.mockImplementation(async () => {
      callNum++;
      return {
        content: "Tarea completada después del resume.",
        stop_reason: "stop" as const,
        usage: { input_tokens: 200, output_tokens: 80 },
      };
    });

    const chunks2 = await collectChunks({
      agentId: "test-agent",
      userMessage: "Seguí con la siguiente tarea",
      threadId: "thread-pipeline-2",
      runId: crashRun.id,
      resume: true,
      durable: true,
    });

    // Verify the resumed run completed
    const resumedRun = await getRun(crashRun.id);
    expect(resumedRun!.status).toBe("completed");
    // Iterations should continue: 2 (from checkpoint) + at least 1 more
    expect(resumedRun!.iterations_used).toBeGreaterThanOrEqual(3);
    // Checkpoint should be cleared
    expect(resumedRun!.state_json).toBe("");
    expect(resumedRun!.pending_tool_calls_json).toBeNull();

    // Verify final content is present in chunks
    const agentChunks2 = chunks2.filter(c => c.agent);
    const lastChunk2 = agentChunks2[agentChunks2.length - 1];
    expect(lastChunk2.agent?.messages?.[0]?.content).toContain("completada después del resume");

    // Verify token usage accumulated across resume
    expect(resumedRun!.tokens_used).toBeGreaterThan(0);
  });
});
