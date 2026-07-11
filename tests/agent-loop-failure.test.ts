/**
 * Tests: durable run finalization on abnormal exits.
 *
 * 1. LLM throws mid-loop → run "failed" with the error, lease released
 * 2. Consumer abandons the generator (break) → run "interrupted", checkpoint
 *    preserved so it stays resumable
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import type { AgentDoc, UserDoc, ProviderDoc, ModelDoc, AgentRunDoc } from "../packages/core/src/storage/collections";
import { runAgent } from "../packages/core/src/agent/agent-loop";

let callLLMSpy: ReturnType<typeof spyOn>;
let resolveProviderConfigSpy: ReturnType<typeof spyOn>;
let executeToolBatchSpy: ReturnType<typeof spyOn>;

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

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  await seedTestAgent();

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
  ).mockResolvedValue({ content: "ok", stop_reason: "stop", usage: { input_tokens: 1, output_tokens: 1 } });

  executeToolBatchSpy = spyOn(
    await import("../packages/core/src/tool-runtime"),
    "executeToolBatch"
  ).mockResolvedValue([]);
});

afterEach(() => {
  callLLMSpy?.mockRestore();
  resolveProviderConfigSpy?.mockRestore();
  executeToolBatchSpy?.mockRestore();
  closeHiveDb();
});

async function getSingleRun(): Promise<AgentRunDoc> {
  const runsCol = await col<AgentRunDoc>("agentRuns");
  const all = await runsCol.scan({});
  expect(all.length).toBe(1);
  return all[0].doc;
}

describe("agent-loop: abnormal exit finalization", () => {
  test("LLM exception → run failed with error, lease released", async () => {
    callLLMSpy.mockImplementation(async () => {
      throw new Error("boom: provider exploded");
    });

    let thrown: Error | null = null;
    try {
      for await (const _chunk of runAgent({
        agentId: "test-agent",
        userMessage: "Hola",
        threadId: "thread-fail",
        durable: true,
      })) { /* consume */ }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("boom");

    const run = await getSingleRun();
    expect(run.status).toBe("failed");
    expect(run.error).toContain("boom");
    // Lease released: no self-renewing phantom
    expect(run.lease_expires_at <= Date.now()).toBe(true);
  });

  test("consumer abandons the generator → run interrupted, checkpoint preserved", async () => {
    // LLM always wants tools → the loop keeps yielding round-trips
    let calls = 0;
    callLLMSpy.mockImplementation(async () => {
      calls++;
      return {
        content: "",
        tool_calls: [
          { id: `tc-${calls}`, type: "function" as const, function: { name: "fake_tool", arguments: "{}" } },
        ],
        stop_reason: "tool_calls" as const,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });
    executeToolBatchSpy.mockImplementation(async (opts: any) =>
      opts.toolCalls.map((tc: any) => ({
        toolCall: tc,
        toolName: tc.function.name,
        result: { ok: true },
        ok: true,
        durationMs: 1,
      }))
    );

    let seen = 0;
    for await (const _chunk of runAgent({
      agentId: "test-agent",
      userMessage: "Trabajá",
      threadId: "thread-abandon",
      durable: true,
      budget: { maxIterations: 8 },
    })) {
      seen++;
      if (seen >= 3) break; // abandon mid-run
    }

    const run = await getSingleRun();
    expect(run.status).toBe("interrupted");
    // interruptRun preserves state_json → resumable
    expect(run.state_json.length).toBeGreaterThan(0);
  });
});
