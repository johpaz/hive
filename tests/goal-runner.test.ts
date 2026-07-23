/**
 * Tests: goal-based continuation (Fase 3).
 *
 * 1. Verifier fails twice, passes on the 3rd attempt → run completed with
 *    goal_attempts = 3
 * 2. maxAttempts exhausted with the verifier always failing → run failed
 *
 * The LLM is mocked: turn calls return working text, verifier calls (detected
 * by the evaluation prompt) return {met, reason} JSON.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import type { AgentDoc, UserDoc, ProviderDoc, ModelDoc, AgentRunDoc } from "../packages/core/src/storage/collections";
import { initDurableQueue, getDurableQueue, type DurableLaneQueue } from "../packages/core/src/gateway/durable-queue";
import { initJobExecutors } from "../packages/core/src/gateway/job-executors";
import { runGoal } from "../packages/core/src/agent/goal-runner";

let callLLMSpy: ReturnType<typeof spyOn>;
let resolveProviderConfigSpy: ReturnType<typeof spyOn>;
let executeToolBatchSpy: ReturnType<typeof spyOn>;
let queue: DurableLaneQueue | null = null;

const VERIFIER_MARKER = "Evaluá si el siguiente objetivo";
const INDEPENDENT_VERIFIER_MARKER = "Auditá independientemente esta entrega";

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

async function setupMocks() {
  resolveProviderConfigSpy = spyOn(
    await import("../packages/core/src/agent/llm-client"),
    "resolveProviderConfig"
  ).mockResolvedValue({
    provider: "hiveagents",
    model: "test-model",
    apiKey: "test-api-key",
    baseUrl: "https://fake.api.com/v1",
  });

  callLLMSpy = spyOn(
    await import("../packages/core/src/agent/llm-client"),
    "callLLM"
  ).mockResolvedValue({
    content: "stub",
    stop_reason: "stop",
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  executeToolBatchSpy = spyOn(
    await import("../packages/core/src/tool-runtime"),
    "executeToolBatch"
  ).mockResolvedValue([]);
}

function restoreMocks() {
  callLLMSpy?.mockRestore();
  resolveProviderConfigSpy?.mockRestore();
  executeToolBatchSpy?.mockRestore();
}

async function findGoalRun(): Promise<AgentRunDoc | null> {
  const runsCol = await col<AgentRunDoc>("agentRuns");
  const all = await runsCol.scan({});
  const goalRuns = all.filter((e) => e.doc.kind === "goal");
  return goalRuns.length > 0 ? goalRuns[0].doc : null;
}

async function waitForGoalRun(statuses: string[], timeoutMs = 8000): Promise<AgentRunDoc> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await findGoalRun();
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Goal run did not reach ${statuses.join("/")} in time`);
}

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  await seedTestAgent();
  await setupMocks();
  initJobExecutors();
  queue = initDurableQueue({ maxGlobalConcurrency: 2 });
});

afterEach(() => {
  restoreMocks();
  queue?.stop();
  queue = null;
  closeHiveDb();
});

describe("goal-runner: verify → continue → complete/fail", () => {
  test("verifier fails twice then passes → run completed with goal_attempts=3", async () => {
    let verifierCalls = 0;
    let independentVerifierCalls = 0;
    callLLMSpy.mockImplementation(async (opts: any) => {
      const msgs = opts.messages ?? [];
      const last = msgs[msgs.length - 1];
      const text = typeof last?.content === "string" ? last.content : "";
      if (text.includes(INDEPENDENT_VERIFIER_MARKER)) {
        independentVerifierCalls++;
        return {
          content: JSON.stringify({
            status: "verified",
            criterion_results: [{
              criterion_id: "objective",
              met: true,
              evidence: ["El verificador preliminar confirmó la meta."],
              check_used: "independent_review",
              confidence: 0.9,
            }],
            summary: "Entrega verificada independientemente.",
            retry_guidance: null,
            risks: [],
          }),
          stop_reason: "stop" as const,
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      }
      if (text.includes(VERIFIER_MARKER)) {
        verifierCalls++;
        const met = verifierCalls >= 3;
        return {
          content: JSON.stringify({ met, reason: met ? "meta lograda" : "todavía falta trabajo" }),
          stop_reason: "stop" as const,
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      }
      return {
        content: "Avancé en la meta.",
        stop_reason: "stop" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    });

    const res = await runGoal({
      agentId: "test-agent",
      threadId: "goal-thread-1",
      userId: "test-user",
      channel: null,
      goal: "meta de prueba",
      maxAttempts: 5,
    });
    expect(res.reason).toContain("enqueued");

    const run = await waitForGoalRun(["completed", "failed"]);
    expect(run.status).toBe("completed");
    expect(run.goal_attempts).toBe(3);
    expect(run.turns_used).toBe(3);
    expect(verifierCalls).toBe(3);
    expect(independentVerifierCalls).toBe(1);
    // Checkpoint state cleared on completion
    expect(run.state_json).toBe("");
  });

  test("budget exhausted (maxAttempts) with verifier always failing → run failed", async () => {
    callLLMSpy.mockImplementation(async (opts: any) => {
      const msgs = opts.messages ?? [];
      const last = msgs[msgs.length - 1];
      const text = typeof last?.content === "string" ? last.content : "";
      if (text.includes(VERIFIER_MARKER)) {
        return {
          content: JSON.stringify({ met: false, reason: "nunca alcanza" }),
          stop_reason: "stop" as const,
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      }
      return {
        content: "Intenté pero no llegué.",
        stop_reason: "stop" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    });

    await runGoal({
      agentId: "test-agent",
      threadId: "goal-thread-2",
      userId: "test-user",
      channel: null,
      goal: "meta imposible",
      maxAttempts: 2,
    });

    const run = await waitForGoalRun(["completed", "failed"]);
    expect(run.status).toBe("failed");
    expect(run.goal_attempts).toBe(2);
    expect(run.error).toContain("budget exhausted");
  });
});
