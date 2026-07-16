/**
 * Real-world latency comparison: causalLog.enabled off vs on.
 *
 * Runs real runAgent() turns against a REAL, already-configured LLM
 * provider — this consumes real quota, bounded by --iterations (default 3,
 * meaning 3 off + 3 on interleaved = 6 real LLM calls).
 *
 * Point it at a HiveDB that already has a working provider (e.g. the local
 * dev DB, where Gemini was already validated end-to-end this session):
 *
 *   HIVE_HOME="$HOME/.hive-dev" HIVE_DEV=true bun run scripts/bench-causal-log.ts --iterations 3
 *
 * Creates one disposable test agent + test conversations/traces for the
 * run and deletes them afterward — never touches your real agents' config.
 * Intentionally does NOT use HIVE_DB_PATH=":memory:": that would skip real
 * disk I/O and understate the actual per-turn cost of the awaited
 * db.append() calls this benchmark exists to measure.
 */

import { col } from "../packages/core/src/storage/hive";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { runAgent } from "../packages/core/src/agent/agent-loop";
import { Benchmark } from "../packages/core/src/utils/benchmark";
import type { AgentDoc, ProviderDoc, ModelDoc, UserDoc } from "../packages/core/src/storage/collections";

const TEST_AGENT_ID = "bench-causal-log-agent";
const THREAD_PREFIX = "bench-causal-log-";
const TEST_PROMPT = "¿Cuánto es el 15% de 240? Respondé solo el número.";

function flagValue(argv: string[], name: string): string | undefined {
  const flag = argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!flag) return undefined;
  if (flag.includes("=")) return flag.split("=")[1];
  return argv[argv.indexOf(flag) + 1];
}

async function findWorkingProvider(): Promise<{ providerId: string; modelId: string } | null> {
  const providersCol = await col<ProviderDoc>("providers");
  const modelsCol = await col<ModelDoc>("models");
  const providers = await providersCol.scan({});
  const models = await modelsCol.scan({});
  for (const p of providers) {
    if (!p.doc.enabled || !p.doc.active || p.doc.category !== "llm") continue;
    const match = models.find((m) => m.doc.provider_id === p.id && m.doc.model_type === "llm");
    if (match) return { providerId: p.id, modelId: match.id };
  }
  return null;
}

async function setupTestAgent(providerId: string, modelId: string, userId: string): Promise<void> {
  const agentsCol = await col<AgentDoc>("agents");
  const now = Date.now();
  await agentsCol.put(TEST_AGENT_ID, {
    id: TEST_AGENT_ID,
    user_id: userId,
    name: "Bench Causal Log (temporal)",
    description: "Agente temporal para scripts/bench-causal-log.ts — borrar si queda huérfano",
    system_prompt: "Sos un asistente de prueba. Respondé breve y directo.",
    tone: "friendly",
    role: "coordinator",
    status: "idle",
    enabled: true,
    provider_id: providerId,
    model_id: modelId,
    tools_json: null,
    skills_json: null,
    parent_id: "__none__",
    max_iterations: 3,
    workspace: null,
    lastTraceAt: null,
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 });
}

async function cleanupTestArtifacts(): Promise<void> {
  const agentsCol = await col<AgentDoc>("agents");
  await agentsCol.delete(TEST_AGENT_ID).catch(() => {});

  const convCol = await col("conversations");
  const testConv = (await convCol.scan({})).filter((e) => (e.doc as any).thread_id?.startsWith(THREAD_PREFIX));
  for (const c of testConv) await convCol.delete(c.id);

  const tracesCol = await col("traces");
  const testTraces = (await tracesCol.scan({})).filter((e) => (e.doc as any).thread_id?.startsWith(THREAD_PREFIX));
  for (const t of testTraces) await tracesCol.delete(t.id);
}

async function runOneTurn(
  userId: string,
  iteration: number,
  causalLogOn: boolean
): Promise<{ durationMs: number; toolCalls: number }> {
  process.env.HIVE_CAUSAL_LOG = causalLogOn ? "true" : "false";
  let toolCalls = 0;
  const bench = new Benchmark(`turn-${iteration}-${causalLogOn ? "on" : "off"}`).start();

  for await (const _chunk of runAgent({
    agentId: TEST_AGENT_ID,
    userId,
    userMessage: TEST_PROMPT,
    threadId: `${THREAD_PREFIX}${iteration}-${causalLogOn ? "on" : "off"}-${Date.now()}`,
    budget: { maxIterations: 3 },
    onStep: async (step) => {
      if (step.type === "tool_call") toolCalls++;
    },
  })) {
    // drain
  }

  const { raw } = bench.stop();
  return { durationMs: raw.duration, toolCalls };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(label: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    label,
    "mean (ms)": mean.toFixed(1),
    "median (ms)": percentile(sorted, 50).toFixed(1),
    "p95 (ms)": percentile(sorted, 95).toFixed(1),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const iterations = parseInt(flagValue(argv, "--iterations") ?? "3", 10);
  const providerOverride = flagValue(argv, "--provider");
  const modelOverride = flagValue(argv, "--model");

  console.log(
    `\n=== bench-causal-log: ${iterations} iteraciones intercaladas por brazo ` +
    `(${iterations * 2} llamadas reales de LLM — consumen cuota real) ===\n`
  );

  let providerId = providerOverride;
  let modelId = modelOverride;
  if (!providerId || !modelId) {
    const found = await findWorkingProvider();
    if (!found) {
      console.error("No se encontró un provider LLM activo+habilitado en esta DB. Configurá uno o pasá --provider/--model.");
      process.exit(1);
    }
    providerId = found.providerId;
    modelId = found.modelId;
  }
  console.log(`Provider: ${providerId} / ${modelId}`);

  const usersCol = await col<UserDoc>("users");
  const anyUser = (await usersCol.scan({ limit: 1 }))[0];
  if (!anyUser) {
    console.error("No hay ningún usuario en esta DB — corré `hive onboard` primero.");
    process.exit(1);
  }

  await setupTestAgent(providerId, modelId, anyUser.id);

  const offSamples: number[] = [];
  const onSamples: number[] = [];
  let offToolCalls = 0;
  let onToolCalls = 0;

  try {
    for (let i = 0; i < iterations; i++) {
      const off = await runOneTurn(anyUser.id, i, false);
      offSamples.push(off.durationMs);
      offToolCalls += off.toolCalls;
      console.log(`  [${i + 1}/${iterations}] off: ${off.durationMs.toFixed(0)}ms (${off.toolCalls} tool calls)`);

      const on = await runOneTurn(anyUser.id, i, true);
      onSamples.push(on.durationMs);
      onToolCalls += on.toolCalls;
      console.log(`  [${i + 1}/${iterations}] on:  ${on.durationMs.toFixed(0)}ms (${on.toolCalls} tool calls)`);
    }
  } finally {
    await cleanupTestArtifacts();
    closeHiveDb();
  }

  const offStats = summarize("off", offSamples);
  const onStats = summarize("on", onSamples);
  const deltaMean = parseFloat(onStats["mean (ms)"]) - parseFloat(offStats["mean (ms)"]);
  const deltaP95 = parseFloat(onStats["p95 (ms)"]) - parseFloat(offStats["p95 (ms)"]);
  const deltaPct = (deltaMean / parseFloat(offStats["mean (ms)"])) * 100;

  console.log("\n=== Resultado ===\n");
  console.table([offStats, onStats]);
  console.log(`Delta media: ${deltaMean.toFixed(1)}ms  |  Delta p95: ${deltaP95.toFixed(1)}ms  |  Delta % (media): ${deltaPct.toFixed(1)}%`);
  console.log(`Tool calls observados: off=${offToolCalls}, on=${onToolCalls}`);
  // Eventos causales aprox. por turno "on": M tool calls + 1 StateTransition + 1 IntentLogged
  const avgCausalEventsPerTurn = onToolCalls / iterations + 2;
  console.log(`Delta normalizado por evento causal (~${avgCausalEventsPerTurn.toFixed(1)} eventos/turno): ${(deltaMean / avgCausalEventsPerTurn).toFixed(1)}ms/evento`);

  process.exit(0);
}

main().catch((err) => {
  console.error("bench-causal-log failed:", err);
  process.exit(1);
});
