import { getDb } from "./sqlite";
import { randomUUID } from "crypto";
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
  try {
    const db = getDb();
    const costUsd = calculateCost(options.model, options.inputTokens, options.outputTokens);

    db.prepare(`
      INSERT INTO usage_records (id, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      options.provider,
      options.model,
      options.inputTokens,
      options.outputTokens,
      costUsd,
      options.latencyMs || null,
      Math.floor(Date.now() / 1000)
    );
    log.info(`[USAGE RECORDED] provider=${options.provider} model=${options.model} input=${options.inputTokens} output=${options.outputTokens} cost=$${costUsd.toFixed(4)}`);
  } catch (error) {
    console.error("Failed to record usage:", error);
  }
}

export function getUsageStats(hours: number = 24): UsageSummary {
  log.info(`[USAGE STATS] Fetching stats for last ${hours} hours`);
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - (hours * 3600);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(toon_saved_tokens), 0) as toon_saved_tokens,
      COALESCE(SUM(toon_saved_cost), 0) as toon_saved_cost,
      COALESCE(SUM(toon_saved_bytes), 0) as toon_saved_bytes,
      COALESCE(SUM(toon_saved_percent), 0) as toon_saved_percent,
      COALESCE(SUM(toon_json_tokens), 0) as toon_json_tokens,
      COALESCE(SUM(toon_toon_tokens), 0) as toon_toon_tokens
    FROM usage_records
    WHERE created_at >= ?
  `).get(since) as { 
    total_input: number; 
    total_output: number; 
    total_cost: number; 
    toon_saved_tokens: number; 
    toon_saved_cost: number;
    toon_saved_bytes: number;
    toon_saved_percent: number;
    toon_json_tokens: number;
    toon_toon_tokens: number;
  };

  const byProvider = db.prepare(`
    SELECT
      provider,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage_records
    WHERE created_at >= ? AND provider != 'toon'
    GROUP BY provider
  `).all(since) as Array<{ provider: string; input_tokens: number; output_tokens: number; cost_usd: number }>;

  const byModel = db.prepare(`
    SELECT
      model,
      provider,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage_records
    WHERE created_at >= ? AND provider != 'toon'
    GROUP BY model
    ORDER BY cost_usd DESC
  `).all(since) as Array<{ model: string; provider: string; input_tokens: number; output_tokens: number; cost_usd: number }>;

  const recentRecords = db.prepare(`
    SELECT * FROM usage_records
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(since) as UsageRecord[];

  const providerMap: UsageSummary["byProvider"] = {};
  for (const p of byProvider) {
    providerMap[p.provider] = {
      inputTokens: p.input_tokens,
      outputTokens: p.output_tokens,
      tokens: p.input_tokens + p.output_tokens,
      costUsd: p.cost_usd
    };
  }

  const modelMap: UsageSummary["byModel"] = {};
  for (const m of byModel) {
    modelMap[m.model] = {
      provider: m.provider,
      inputTokens: m.input_tokens,
      outputTokens: m.output_tokens,
      tokens: m.input_tokens + m.output_tokens,
      costUsd: m.cost_usd
    };
  }

  const totalTokens = totals.total_input + totals.total_output;
  const totalIncludingSaved = totalTokens + totals.toon_saved_tokens;
  const toonSavingsPercent = totalIncludingSaved > 0
    ? (totals.toon_saved_tokens / totalIncludingSaved) * 100
    : 0;

  // Calculate average bytes savings percent
  const toonSavedBytesPercent = totals.toon_toon_tokens > 0
    ? (totals.toon_saved_bytes / totals.toon_toon_tokens) * 100
    : 0;

  return {
    totalTokens,
    totalInputTokens: totals.total_input,
    totalOutputTokens: totals.total_output,
    totalCostUsd: totals.total_cost,
    toonSavedTokens: totals.toon_saved_tokens,
    toonSavedCost: totals.toon_saved_cost,
    toonSavedBytes: totals.toon_saved_bytes,
    toonSavedBytesPercent,
    toonJsonTokens: totals.toon_json_tokens,
    toonToonTokens: totals.toon_toon_tokens,
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
      const db = getDb();

      // Insert TOON savings record with complete metrics
      db.query(`
        INSERT INTO usage_records (
          id, provider, model, input_tokens, output_tokens, cost_usd,
          toon_saved_tokens, toon_saved_cost,
          toon_json_bytes, toon_toon_bytes, toon_saved_bytes, toon_saved_percent,
          toon_json_tokens, toon_toon_tokens, toon_saved_tokens_pct,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `toon_${category}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        'toon',
        category,
        0,
        0,
        0,
        Math.max(0, analysis.savedTokens),
        costSaved,
        analysis.jsonBytes,
        analysis.toonBytes,
        analysis.savedBytes,
        Math.max(0, analysis.savedPercent),
        analysis.jsonTokens,
        analysis.toonTokens,
        Math.max(0, analysis.savedTokensPercent),
        Math.floor(Date.now() / 1000),
      )

      log.debug(`[TOON] Recorded ${analysis.savedTokens} tokens ($${costSaved.toFixed(6)}) saved for ${category}`)
    } catch (error) {
      log.warn(`[TOON] Failed to record savings:`, error)
    }
  })
}
