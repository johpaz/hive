/** Optional decision plane. Jev is never used through the chat completions API. */
import { col } from "../storage/hive"
import type { ProviderDoc } from "../storage/collections"
import { loadProviderApiKey } from "../storage/crypto"
import { recordJevDecision, recordUsage } from "../storage/usage"
import { catalogModelKey } from "../storage/model-id"
import { logger } from "../utils/logger"
import { emitCanvas, type CanvasJevDecision } from "../canvas/emitter"

const log = logger.child("jev-decisions")
export const JEV_MODEL = "typesafe/jev-1.13"
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
const TIMEOUT_MS = 3000
const COOLDOWN_MS = 60_000
/** Kev: same oracle served from the HiveAgents LLM host (llm.hiveagents.io), tried before Jev. */
export const KEV_MODEL = "Kev-9B-Q8_0.gguf"
const KEV_DEFAULT_BASE = "https://llm.hiveagents.io"
const KEV_READY_TTL_MS = 30_000
const KEV_STATUS_TIMEOUT_MS = 2000
export type DecisionBackend = "kev" | "jev"
let failures = 0
let cooldownUntil = 0
let lastError: string | null = null
let lastSuccessAt: number | null = null
let kevFailures = 0
let kevCooldownUntil = 0
let kevReadyCache: { at: number; ready: boolean } | null = null
let lastBackend: DecisionBackend | null = null
let decisionSequence = 0
/** Since gateway boot; the office shows them as the oracle's running contribution. */
const totals = { decisions: 0, savedTokens: 0, costUsd: 0 }

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria?: Record<string, string> }

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number }

export interface JevResult {
  answers: Record<string, JevAnswer>
  inputTokens: number
  costUsd: number
  latencyMs: number
  backend: DecisionBackend
}

export async function getJevKey(): Promise<string | null> {
  const provider = await (await col<ProviderDoc>("providers")).get("openrouter")
  if (!provider?.doc.enabled || !provider.doc.active) return null
  return (await loadProviderApiKey("openrouter")) || process.env.OPENROUTER_API_KEY || null
}

/** Kev is available when the HiveAgents LLM provider is on and has a key; readiness is checked separately. */
async function getKevConfig(): Promise<{ key: string; base: string } | null> {
  const provider = await (await col<ProviderDoc>("providers")).get("hiveagents")
  if (!provider?.doc.enabled || !provider.doc.active) return null
  const key = (await loadProviderApiKey("hiveagents")) || process.env.HIVEAGENTS_API_KEY || null
  if (!key) return null
  return { key, base: provider.doc.base_url?.replace(/\/v1\/?$/, "").replace(/\/$/, "") || KEV_DEFAULT_BASE }
}

/** `kev-decision.service` is toggled with systemd on the lab PC, so ask the host; cached to spare every turn a request. */
async function isKevReady(cfg: { key: string; base: string }, fetcher: typeof fetch): Promise<boolean> {
  if (Date.now() < kevCooldownUntil) return false
  if (kevReadyCache && Date.now() - kevReadyCache.at < KEV_READY_TTL_MS) return kevReadyCache.ready
  let ready = false
  try {
    const response = await fetcher(`${cfg.base}/api/decisions/status`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
      signal: AbortSignal.timeout(KEV_STATUS_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) kevCooldownUntil = Date.now() + COOLDOWN_MS
    else if (response.ok) {
      const data = await response.json().catch(() => null) as { ready?: unknown } | null
      ready = data?.ready === true
    }
  } catch { /* host unreachable: Kev is simply off */ }
  kevReadyCache = { at: Date.now(), ready }
  return ready
}

/** True when any decision backend could answer; callers use it to skip building questions. */
export async function hasDecisionBackend(): Promise<boolean> {
  if (await getJevKey().catch(() => null)) return true
  const kev = await getKevConfig().catch(() => null)
  return !!kev && Date.now() >= kevCooldownUntil
}

export interface JevStatus {
  state: "off" | "ready" | "fallback"
  backend: DecisionBackend | null
  lastError: string | null
  lastSuccessAt: number | null
  totals: { decisions: number; savedTokens: number; costUsd: number }
}

export async function getJevStatus(): Promise<JevStatus> {
  const key = await getJevKey().catch(() => null)
  const kev = await getKevConfig().catch(() => null)
  const jevOk = !!key && Date.now() >= cooldownUntil && !lastError
  const kevOk = !!kev && Date.now() >= kevCooldownUntil && kevFailures === 0
  // Before any decision has been served, report who would answer: Kev only when its host says ready.
  const kevReady = kevOk && kev ? await isKevReady(kev, fetch).catch(() => false) : false
  return {
    state: !key && !kev ? "off" : jevOk || kevReady ? "ready" : "fallback",
    backend: kevReady ? "kev" : lastBackend ?? (jevOk ? "jev" : null),
    lastError: key || kev ? lastError : null,
    lastSuccessAt: key || kev ? lastSuccessAt : null,
    totals: { ...totals },
  }
}

function broadcastStatus(): void {
  getJevStatus().then(status => emitCanvas("canvas:jev_status", status)).catch(() => { /* best effort */ })
}

/**
 * Publishes a served decision to the office and persists it for the dashboard.
 * Callers estimate savings; Jev itself only answers questions. `provider`/`model`
 * are the advised agent's main model, used to price the avoided tokens.
 */
export function emitJevDecision({ provider, model, ...decision }: Omit<CanvasJevDecision, "eventId" | "totals"> & { provider: string; model: string }): void {
  recordJevDecision({ agentId: decision.agentId, provider, model, savedTokens: decision.savedTokens, costUsd: decision.costUsd })
  totals.decisions++
  totals.savedTokens += decision.savedTokens
  totals.costUsd += decision.costUsd
  emitCanvas("canvas:jev_decision", {
    ...decision,
    eventId: `jev:${Date.now().toString(36)}:${++decisionSequence}`,
    summary: decision.summary.slice(0, 160),
    totals: { ...totals },
  } satisfies CanvasJevDecision)
}

export function resetJevStatus(): void {
  failures = 0
  cooldownUntil = 0
  lastError = null
  lastSuccessAt = null
  kevFailures = 0
  kevCooldownUntil = 0
  kevReadyCache = null
  lastBackend = null
  broadcastStatus()
}

function validateAnswers(questions: Record<string, JevQuestion>, data: { answers?: Record<string, JevAnswer> }): Record<string, JevAnswer> {
  const answers: Record<string, JevAnswer> = {}
  const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1
  for (const [name, question] of Object.entries(questions)) {
    const answer = data.answers?.[name]
    if (question.type === "choice") {
      if (answer?.type !== "choice" || !Object.hasOwn(question.criteria, answer.choice) || !unit(answer.confidence)) {
        throw new Error(`Invalid choice answer: ${name}`)
      }
    } else if (question.type === "score") {
      if (answer?.type !== "score" || !unit(answer.score)) throw new Error(`Invalid score answer: ${name}`)
    } else if (answer?.type !== "noul" || !unit(answer.noul)) {
      throw new Error(`Invalid noul answer: ${name}`)
    }
    answers[name] = answer
  }
  return answers
}

export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<JevResult | null> {
  if (Object.keys(questions).length === 0) return null
  const fetcher = options.fetcher ?? fetch
  const kev = await getKevConfig().catch(() => null)
  if (kev && await isKevReady(kev, fetcher)) {
    const result = await requestDecision("kev", `${kev.base}/v1/systemone`, kev.key, KEV_MODEL, state, questions, options)
    if (result || options.signal?.aborted) return result
  }
  const key = await getJevKey().catch(() => null)
  if (!key || Date.now() < cooldownUntil) return null
  return requestDecision("jev", ENDPOINT, key, JEV_MODEL, state, questions, options)
}

async function requestDecision(
  backend: DecisionBackend,
  endpoint: string,
  key: string,
  model: string,
  state: unknown,
  questions: Record<string, JevQuestion>,
  options: { fetcher?: typeof fetch; signal?: AbortSignal },
): Promise<JevResult | null> {
  const started = performance.now()
  const label = backend === "kev" ? "Kev" : "OpenRouter"
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        if (backend === "kev") kevCooldownUntil = Date.now() + COOLDOWN_MS
        else cooldownUntil = Date.now() + COOLDOWN_MS
      }
      throw new Error(`${label} HTTP ${response.status}`)
    }
    const data = await response.json() as {
      answers?: Record<string, JevAnswer>
      usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
    }
    const answers = validateAnswers(questions, data)
    const recovered = lastError !== null
    if (backend === "kev") kevFailures = 0
    else failures = 0
    lastError = null
    lastSuccessAt = Date.now()
    if (recovered || lastBackend !== backend) { lastBackend = backend; broadcastStatus() }
    const inputTokens = data.usage?.input_tokens ?? 0
    // Kev runs on our own hardware: no per-token cost.
    const costUsd = backend === "kev" ? 0 : data.usage?.cost ?? inputTokens * 0.042 / 1_000_000
    log.info(`Decision served: backend=${backend} questions=${Object.keys(questions).join(",")} latency_ms=${Math.round(performance.now() - started)} input_tokens=${inputTokens} cost_usd=${costUsd}`)
    if (inputTokens > 0) {
      const provider = backend === "kev" ? "hiveagents" : "openrouter"
      recordUsage({ provider, model: catalogModelKey(provider, model), inputTokens, outputTokens: data.usage?.output_tokens ?? 0, latencyMs: Math.round(performance.now() - started) })
    }
    return { answers, inputTokens, costUsd, latencyMs: Math.round(performance.now() - started), backend }
  } catch (error) {
    if (options.signal?.aborted) return null
    lastError = error instanceof Error ? error.message : `${label} unavailable`
    if (backend === "kev") {
      if (++kevFailures >= 3) { kevCooldownUntil = Date.now() + COOLDOWN_MS; kevReadyCache = null }
    } else if (++failures >= 3) cooldownUntil = Date.now() + COOLDOWN_MS
    log.warn(`Decision fallback (${backend}): ${lastError}`)
    broadcastStatus()
    return null
  }
}
