import { col, nextId, bumpRollup } from "./hive";
import type { ModelDoc, UsageRecordDoc, UsageRollupDoc } from "./collections";
import { logger } from "../utils/logger";

const log = logger.child("usage");

/**
 * Costo de una llamada, en USD.
 *
 * El precio vive en la propia fila del modelo (`ModelDoc.input_per_1m` /
 * `output_per_1m`), sembrada desde SEED_DATA.models. Antes había acá un mapa
 * `MODEL_PRICING` hardcodeado en paralelo al catálogo: mantener dos listas en
 * sincronía fallaba en silencio — un modelo sembrado sin entrada en el mapa
 * costaba $0 sin avisar.
 */

/** Precio por id de modelo. Se llena bajo demanda y lo invalida el re-seed. */
let pricingCache: Map<string, { input: number; output: number } | null> | null = null;

/** Llamar cuando el catálogo cambie, para que el próximo costo relea de la BD. */
export function invalidateModelPricingCache(): void {
  pricingCache = null;
}

async function loadPricing(): Promise<Map<string, { input: number; output: number } | null>> {
  if (pricingCache) return pricingCache;
  const cache = new Map<string, { input: number; output: number } | null>();
  try {
    const modelsCol = await col<ModelDoc>("models");
    for (const row of await modelsCol.scan({})) {
      const { input_per_1m: i, output_per_1m: o } = row.doc;
      cache.set(row.id, i == null && o == null ? null : { input: i ?? 0, output: o ?? 0 });
    }
    pricingCache = cache;
  } catch {
    // La BD puede no estar lista todavía (arranque temprano): no cachear el
    // resultado vacío o el costo quedaría en 0 para toda la vida del proceso.
    return cache;
  }
  return cache;
}

/** Modelos ya avisados, para no repetir el warning en cada llamada. */
const unpricedModels = new Set<string>();

export async function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> {
  const pricing = (await loadPricing()).get(model);

  if (!pricing) {
    // Sin esto un modelo sin tarifa aparece como $0.00 en el dashboard, que es
    // indistinguible de un modelo realmente gratuito.
    const key = `${provider}/${model}`;
    if (!unpricedModels.has(key)) {
      unpricedModels.add(key);
      log.warn(`[usage] Sin tarifa para ${key} — su costo se contará como $0. Agregá inputPer1M/outputPer1M en SEED_DATA.models (storage/seed.ts).`);
    }
    return 0;
  }

  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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
      const costUsd = await calculateCost(options.provider, options.model, options.inputTokens, options.outputTokens);
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
