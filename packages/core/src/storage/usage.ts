import { col, nextId, bumpRollup } from "./hive";
import type { UsageRecordDoc, UsageRollupDoc } from "./collections";
import { logger } from "../utils/logger";

const log = logger.child("usage");

// Precios en USD por millón de tokens (input / output)
// Fuentes: docs.anthropic.com, openrouter.ai/api/v1/models, api-docs.deepseek.com, console.groq.com
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // ── Anthropic (fuente: docs.anthropic.com) ──
  "claude-opus-4-6":           { inputPer1M: 5,    outputPer1M: 25   },
  "claude-sonnet-4-6":         { inputPer1M: 3,    outputPer1M: 15   },
  "claude-haiku-4-5-20251001": { inputPer1M: 1,    outputPer1M: 5    },
  "anthropic/claude-opus-4-6":   { inputPer1M: 5,  outputPer1M: 25   },
  "anthropic/claude-sonnet-4-6": { inputPer1M: 3,  outputPer1M: 15   },

  // ── OpenAI (fuente: openrouter.ai/api/v1/models) ──
  "gpt-4o":         { inputPer1M: 2.5,  outputPer1M: 10    },
  "gpt-4o-mini":    { inputPer1M: 0.15, outputPer1M: 0.6   },
  "gpt-5.4":        { inputPer1M: 2.5,  outputPer1M: 15    },
  "gpt-5.4-pro":    { inputPer1M: 30,   outputPer1M: 180   },
  "gpt-5.3":        { inputPer1M: 1.75, outputPer1M: 14    },
  "gpt-5.2":        { inputPer1M: 1.75, outputPer1M: 14    },
  "o4-mini":        { inputPer1M: 1.1,  outputPer1M: 4.4   },
  "openai/gpt-5.4":     { inputPer1M: 2.5,  outputPer1M: 15  },
  "openai/gpt-5.4-pro": { inputPer1M: 30,   outputPer1M: 180 },
  "openai/gpt-5.2":     { inputPer1M: 1.75, outputPer1M: 14  },
  // Groq OSS (fuente: console.groq.com)
  "openai/gpt-oss-120b": { inputPer1M: 0.15, outputPer1M: 0.6  },
  "openai/gpt-oss-20b":  { inputPer1M: 0.075, outputPer1M: 0.3 },

  // ── Google Gemini (fuente: openrouter.ai/api/v1/models) ──
  "gemini-3.1-pro-preview":        { inputPer1M: 2,    outputPer1M: 12   },
  "gemini-3.1-flash-lite-preview":  { inputPer1M: 0.25, outputPer1M: 1.5  },
  "gemini-3-flash-preview":         { inputPer1M: 0.5,  outputPer1M: 3    },
  "gemini-2.5-pro":                 { inputPer1M: 1.25, outputPer1M: 10   },
  "gemini-2.5-flash":               { inputPer1M: 0.15, outputPer1M: 0.6  },
  "gemini-2.0-flash":               { inputPer1M: 0.1,  outputPer1M: 0.4  },
  "gemini-2.0-flash-lite":          { inputPer1M: 0.075, outputPer1M: 0.3 },
  "google/gemini-3.1-pro-preview":        { inputPer1M: 2,    outputPer1M: 12  },
  "google/gemini-3.1-flash-lite-preview": { inputPer1M: 0.25, outputPer1M: 1.5 },
  "google/gemini-3-flash-preview":        { inputPer1M: 0.5,  outputPer1M: 3   },
  "google/gemini-2.5-flash":              { inputPer1M: 0.15, outputPer1M: 0.6 },

  // ── Mistral (fuente: openrouter.ai/api/v1/models) ──
  "mistral-large-2512":             { inputPer1M: 0.5,  outputPer1M: 1.5  },
  "devstral-2512":                  { inputPer1M: 0.4,  outputPer1M: 2    },
  "ministral-14b-2512":             { inputPer1M: 0.2,  outputPer1M: 0.2  },
  "ministral-8b-2512":              { inputPer1M: 0.15, outputPer1M: 0.15 },
  "codestral-2508":                 { inputPer1M: 0.2,  outputPer1M: 0.6  },
  "mistral-small-3.2-24b-instruct": { inputPer1M: 0.1,  outputPer1M: 0.3  },
  "mistral-large-latest":           { inputPer1M: 0.5,  outputPer1M: 1.5  },
  "codestral-latest":               { inputPer1M: 0.2,  outputPer1M: 0.6  },

  // ── DeepSeek (fuente: api-docs.deepseek.com/quick_start/pricing) ──
  "deepseek-chat":     { inputPer1M: 0.28, outputPer1M: 0.42 },
  "deepseek-reasoner": { inputPer1M: 0.28, outputPer1M: 0.42 },
  "deepseek/deepseek-v3.2":   { inputPer1M: 0.25, outputPer1M: 0.4  },
  "deepseek/deepseek-r1:free": { inputPer1M: 0,    outputPer1M: 0    },

  // ── Kimi / Moonshot (fuente: openrouter.ai/moonshotai) ──
  "kimi-k2.5":          { inputPer1M: 0.45, outputPer1M: 2.2  },
  "kimi-k2":            { inputPer1M: 0.45, outputPer1M: 2.2  },
  "moonshot-v1-8k":     { inputPer1M: 1.67, outputPer1M: 1.67 },
  "moonshot-v1-32k":    { inputPer1M: 3.33, outputPer1M: 3.33 },
  "moonshot-v1-128k":   { inputPer1M: 8.33, outputPer1M: 8.33 },
  "moonshotai/kimi-k2.5":            { inputPer1M: 0.45, outputPer1M: 2.2 },
  "moonshotai/kimi-k2-instruct-0905": { inputPer1M: 0.45, outputPer1M: 2.2 },

  // ── Meta Llama (vía OpenRouter) ──
  "meta-llama/llama-3.3-70b-instruct": { inputPer1M: 0.88, outputPer1M: 0.88 },
  "meta-llama/llama-4-maverick":       { inputPer1M: 0.2,  outputPer1M: 0.8  },

  // ── Qwen (vía OpenRouter) ──
  "qwen/qwen3.5-plus-02-15":  { inputPer1M: 0.26, outputPer1M: 1.56 },
  "qwen/qwen3.5-flash-02-23": { inputPer1M: 0.1,  outputPer1M: 0.4  },
  "qwen/qwen3-32b":           { inputPer1M: 0,    outputPer1M: 0    },

  // ── Groq (fuente: console.groq.com/docs/models) ──
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant":    { inputPer1M: 0.05, outputPer1M: 0.08 },
  "groq/compound":            { inputPer1M: 0,    outputPer1M: 0    },
  "groq/compound-mini":       { inputPer1M: 0,    outputPer1M: 0    },

  // ── Ollama local = siempre free ──
  "qwen3:4b":    { inputPer1M: 0, outputPer1M: 0 },
  "qwen3:8b":    { inputPer1M: 0, outputPer1M: 0 },
  "qwen3:14b":   { inputPer1M: 0, outputPer1M: 0 },
  "llama3.2:3b": { inputPer1M: 0, outputPer1M: 0 },
  "gemma3:9b":   { inputPer1M: 0, outputPer1M: 0 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || { inputPer1M: 0, outputPer1M: 0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

/** Hourly bucket key ("2026-07-09T14") — lexicographic order matches chronological order. */
export function hourBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 13);
}

function emptyRollup(): UsageRollupDoc {
  return {
    inputTokens: 0, outputTokens: 0, costUsd: 0,
    toonSavedTokens: 0, toonSavedCost: 0, toonSavedBytes: 0,
    toonJsonTokens: 0, toonToonTokens: 0, toonJsonBytes: 0,
    byProvider: {}, byModel: {},
  };
}

/**
 * Applies the top-level token/cost delta exactly once, plus both the
 * byProvider and byModel nested breakdowns, in a single read-modify-write.
 * `bumpRollup`'s generic helper only supports one nested dimension per call —
 * calling it twice here would double-apply the top-level delta.
 */
async function bumpUsageRollup(
  hour: string,
  delta: { inputTokens: number; outputTokens: number; costUsd: number },
  provider: string,
  model: string
): Promise<void> {
  const rollupsCol = await col<UsageRollupDoc>("usageRollups");
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await rollupsCol.get(hour);
    // Merge over emptyRollup() defaults, not just the raw existing doc — a rollup
    // for this hour may have been created by recordToonSavings()'s generic
    // bumpRollup() call, which never initializes byProvider/byModel.
    const doc = existing ? { ...emptyRollup(), ...existing.doc } : emptyRollup();

    doc.inputTokens += delta.inputTokens;
    doc.outputTokens += delta.outputTokens;
    doc.costUsd += delta.costUsd;

    const curProvider = doc.byProvider[provider] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    doc.byProvider = {
      ...doc.byProvider,
      [provider]: {
        inputTokens: curProvider.inputTokens + delta.inputTokens,
        outputTokens: curProvider.outputTokens + delta.outputTokens,
        costUsd: curProvider.costUsd + delta.costUsd,
      },
    };

    const curModel = doc.byModel[model] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    doc.byModel = {
      ...doc.byModel,
      [model]: {
        inputTokens: curModel.inputTokens + delta.inputTokens,
        outputTokens: curModel.outputTokens + delta.outputTokens,
        costUsd: curModel.costUsd + delta.costUsd,
      },
    };

    try {
      await rollupsCol.put(hour, doc, { expectedVersion: existing?.version ?? 0 });
      return;
    } catch {
      // Version conflict — retry with a fresh read.
    }
  }
  log.warn(`[USAGE] bumpUsageRollup: too much contention on usageRollups/${hour}`);
}

export interface UsageRecord {
  id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  toon_saved_tokens: number;
  toon_saved_cost: number;
  toon_json_bytes: number;
  toon_toon_bytes: number;
  toon_saved_bytes: number;
  toon_saved_percent: number;
  toon_json_tokens: number;
  toon_toon_tokens: number;
  toon_saved_tokens_pct: number;
  created_at: number;
}

export interface UsageSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  toonSavedTokens: number;
  toonSavedCost: number;
  toonSavedBytes: number;
  toonSavedBytesPercent: number;
  toonJsonTokens: number;
  toonToonTokens: number;
  toonSavingsPercent: number;
  byProvider: Record<string, { tokens: number; costUsd: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { tokens: number; costUsd: number; provider: string; inputTokens: number; outputTokens: number }>;
  recentRecords: UsageRecord[];
}

export function recordUsage(options: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
}): void {
  // Fire-and-forget to avoid blocking the LLM call path.
  Promise.resolve().then(async () => {
    try {
      const costUsd = calculateCost(options.model, options.inputTokens, options.outputTokens);
      const now = Date.now();

      const id = await nextId("usageRecords");
      const recordsCol = await col<UsageRecordDoc>("usageRecords");
      await recordsCol.put(id, {
        id,
        provider: options.provider,
        model: options.model,
        input_tokens: options.inputTokens,
        output_tokens: options.outputTokens,
        cost_usd: costUsd,
        latency_ms: options.latencyMs || null,
        toon_saved_tokens: 0,
        toon_saved_cost: 0,
        toon_json_bytes: 0,
        toon_toon_bytes: 0,
        toon_saved_bytes: 0,
        toon_saved_percent: 0,
        toon_json_tokens: 0,
        toon_toon_tokens: 0,
        toon_saved_tokens_pct: 0,
        created_at: now,
      }, { expectedVersion: 0 });

      const hour = hourBucket(now);
      const delta = { inputTokens: options.inputTokens, outputTokens: options.outputTokens, costUsd };
      await bumpUsageRollup(hour, delta, options.provider, options.model);

      log.info(`[USAGE RECORDED] provider=${options.provider} model=${options.model} input=${options.inputTokens} output=${options.outputTokens} cost=$${costUsd.toFixed(4)}`);
    } catch (error) {
      console.error("Failed to record usage:", error);
    }
  });
}

/** Every hour bucket key from `hours` ago through now, oldest first. */
function hourBucketsSince(hours: number): string[] {
  const now = Date.now();
  const buckets: string[] = [];
  for (let t = now - hours * 3600_000; t <= now; t += 3600_000) {
    buckets.push(hourBucket(t));
  }
  return buckets;
}

export async function getUsageStats(hours: number = 24): Promise<UsageSummary> {
  log.info(`[USAGE STATS] Fetching stats for last ${hours} hours`);

  const rollupsCol = await col<UsageRollupDoc>("usageRollups");
  const buckets = hourBucketsSince(hours);
  const rollups = (await Promise.all(buckets.map((id) => rollupsCol.get(id))))
    .map((e) => e?.doc ?? emptyRollup());

  const providerMap: UsageSummary["byProvider"] = {};
  const modelMap: UsageSummary["byModel"] = {};
  let totalInput = 0, totalOutput = 0, totalCost = 0;
  let toonSavedTokens = 0, toonSavedCost = 0, toonSavedBytes = 0;
  let toonJsonTokens = 0, toonToonTokens = 0, toonJsonBytes = 0;

  for (const r of rollups) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCost += r.costUsd;
    toonSavedTokens += r.toonSavedTokens;
    toonSavedCost += r.toonSavedCost;
    toonSavedBytes += r.toonSavedBytes;
    toonJsonTokens += r.toonJsonTokens;
    toonToonTokens += r.toonToonTokens;
    toonJsonBytes += r.toonJsonBytes;

    for (const [provider, p] of Object.entries(r.byProvider ?? {})) {
      const cur = providerMap[provider] ?? { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      cur.inputTokens += p.inputTokens;
      cur.outputTokens += p.outputTokens;
      cur.tokens += p.inputTokens + p.outputTokens;
      cur.costUsd += p.costUsd;
      providerMap[provider] = cur;
    }
    for (const [model, m] of Object.entries(r.byModel ?? {})) {
      const cur = modelMap[model] ?? { provider: "unknown", tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      cur.inputTokens += m.inputTokens;
      cur.outputTokens += m.outputTokens;
      cur.tokens += m.inputTokens + m.outputTokens;
      cur.costUsd += m.costUsd;
      modelMap[model] = cur;
    }
  }

  const sinceMs = Date.now() - hours * 3600_000;
  const recordsCol = await col<UsageRecordDoc>("usageRecords");
  const recentRecords = (await recordsCol.scan({ reverse: true, limit: 20 }))
    .map((e) => e.doc)
    .filter((r) => r.created_at >= sinceMs);

  const totalTokens = totalInput + totalOutput;
  const totalIncludingSaved = totalTokens + toonSavedTokens;
  const toonSavingsPercent = totalIncludingSaved > 0
    ? (toonSavedTokens / totalIncludingSaved) * 100
    : 0;

  // Ratio-of-sums (not mean-of-per-record-percentages) — avoids bias from varying record sizes.
  const toonSavedBytesPercent = toonJsonBytes > 0
    ? (toonSavedBytes / toonJsonBytes) * 100
    : 0;

  return {
    totalTokens,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCostUsd: totalCost,
    toonSavedTokens,
    toonSavedCost,
    toonSavedBytes,
    toonSavedBytesPercent,
    toonJsonTokens,
    toonToonTokens,
    toonSavingsPercent,
    byProvider: providerMap,
    byModel: modelMap,
    recentRecords
  };
}

export function getProviderPricing(provider: string, model: string): { inputPer1M: number; outputPer1M: number } {
  return MODEL_PRICING[model] || { inputPer1M: 0, outputPer1M: 0 };
}

export function estimateCostForTokens(model: string, tokens: number): number {
  const pricing = MODEL_PRICING[model] || { inputPer1M: 0, outputPer1M: 0 };
  return (tokens / 1_000_000) * pricing.inputPer1M;
}

/**
 * Get average cost per token for a model (input + output average)
 */
export function getAverageTokenCost(model: string): number {
  // 1. Exact match
  let pricing = MODEL_PRICING[model];

  // 2. Try stripping a single provider prefix (e.g. "openrouter/moonshotai/kimi" → "moonshotai/kimi")
  if (!pricing) {
    const slashIdx = model.indexOf('/');
    if (slashIdx !== -1) {
      pricing = MODEL_PRICING[model.slice(slashIdx + 1)];
    }
  }

  // 3. Partial match — find any key whose name is contained in the model string
  if (!pricing) {
    for (const [key, p] of Object.entries(MODEL_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        pricing = p;
        break;
      }
    }
  }

  if (!pricing) return 0;
  // Average of input and output cost per token
  return (pricing.inputPer1M + pricing.outputPer1M) / 2 / 1_000_000;
}

/**
 * Record TOON savings for metrics tracking
 * This updates the usage_records table with complete TOON compression metrics
 */
export function recordToonSavings(
  analysis: {
    jsonBytes: number;
    toonBytes: number;
    savedBytes: number;
    savedPercent: number;
    jsonTokens: number;
    toonTokens: number;
    savedTokens: number;
    savedTokensPercent: number;
  },
  costSaved: number,
  category: string
): void {
  // Fire-and-forget to avoid blocking
  Promise.resolve().then(async () => {
    try {
      const now = Date.now();
      const savedTokens = Math.max(0, analysis.savedTokens);
      const savedPercent = Math.max(0, analysis.savedPercent);
      const savedTokensPct = Math.max(0, analysis.savedTokensPercent);

      // Insert TOON savings record with complete metrics
      const id = await nextId("usageRecords");
      const recordsCol = await col<UsageRecordDoc>("usageRecords");
      await recordsCol.put(id, {
        id,
        provider: "toon",
        model: category,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_ms: null,
        toon_saved_tokens: savedTokens,
        toon_saved_cost: costSaved,
        toon_json_bytes: analysis.jsonBytes,
        toon_toon_bytes: analysis.toonBytes,
        toon_saved_bytes: analysis.savedBytes,
        toon_saved_percent: savedPercent,
        toon_json_tokens: analysis.jsonTokens,
        toon_toon_tokens: analysis.toonTokens,
        toon_saved_tokens_pct: savedTokensPct,
        created_at: now,
      }, { expectedVersion: 0 });

      // Only the toon-specific fields go into the rollup — no byProvider/byModel
      // breakdown for these (they carry no real token/cost data of their own).
      await bumpRollup("usageRollups", hourBucket(now), {
        toonSavedTokens: savedTokens,
        toonSavedCost: costSaved,
        toonSavedBytes: analysis.savedBytes,
        toonJsonTokens: analysis.jsonTokens,
        toonToonTokens: analysis.toonTokens,
        toonJsonBytes: analysis.jsonBytes,
      });

      log.debug(`[TOON] Recorded ${analysis.savedTokens} tokens ($${costSaved.toFixed(6)}) saved for ${category}`)
    } catch (error) {
      log.warn(`[TOON] Failed to record savings:`, error)
    }
  })
}
