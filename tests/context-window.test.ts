/**
 * The context window Hive budgets for must be the one the provider reads.
 * Ollama keeps only num_ctx tokens and drops the rest without an error: with
 * the model row saying 32k and num_ctx at 4096, Bee's ~22k-token prompts
 * arrived cut and it answered without most of its instructions.
 */
process.env.HIVE_DB_PATH = ":memory:"

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap"
import { closeHiveDb } from "../packages/core/src/storage/hivedb"
import { col } from "../packages/core/src/storage/hive"
import type { ModelDoc, ProviderDoc } from "../packages/core/src/storage/collections"
import { resolveProviderConfig, type LLMMessage } from "../packages/core/src/agent/llm-client"
import { fitMessagesToBudget } from "../packages/core/src/agent/context-compiler"
import { OLLAMA_DEFAULT_NUM_CTX } from "../packages/core/src/agent/llm-providers/ollama"

async function setOllama(numCtx: number | null, contextWindow: number) {
  const providers = await col<ProviderDoc>("providers")
  const existing = await providers.get("ollama")
  await providers.put("ollama", {
    id: "ollama", name: "Ollama", base_url: "http://localhost:11434", category: "llm",
    num_ctx: numCtx, num_gpu: -1, enabled: true, active: true, created_at: 1,
  }, { expectedVersion: existing?.version ?? 0 })
  const models = await col<ModelDoc>("models")
  const model = await models.get("gemma4:e4b")
  await models.put("gemma4:e4b", {
    id: "gemma4:e4b", provider_id: "ollama", name: "gemma4:e4b", model_type: "llm",
    context_window: contextWindow, capabilities: null, enabled: true, active: true, source: "discovered",
  } as ModelDoc, { expectedVersion: model?.version ?? 0 })
}

beforeEach(async () => {
  closeHiveDb()
  await ensureHiveDb()
})
afterEach(() => closeHiveDb())

describe("effective context window", () => {
  test("Ollama without num_ctx sends and budgets the same default", async () => {
    await setOllama(null, 32768)
    const cfg = await resolveProviderConfig("ollama", "gemma4:e4b")
    expect(cfg.numCtx).toBe(OLLAMA_DEFAULT_NUM_CTX)
    expect(cfg.contextWindow).toBe(OLLAMA_DEFAULT_NUM_CTX)
  })

  test("a num_ctx set by the user is what the compiler budgets for", async () => {
    await setOllama(4096, 32768)
    const cfg = await resolveProviderConfig("ollama", "gemma4:e4b")
    expect(cfg.numCtx).toBe(4096)
    expect(cfg.contextWindow).toBe(4096)
  })

  test("a model smaller than the default is never asked for more than it has", async () => {
    await setOllama(null, 8192)
    const cfg = await resolveProviderConfig("ollama", "gemma4:e4b")
    expect(cfg.numCtx).toBe(8192)
    expect(cfg.contextWindow).toBe(8192)
  })
})

describe("history budget", () => {
  const msg = (role: "user" | "assistant", chars: number, tag = ""): LLMMessage => ({ role, content: tag + "x".repeat(chars) })

  test("history that fits is returned untouched", () => {
    const messages = [msg("user", 40), msg("assistant", 40)]
    expect(fitMessagesToBudget(messages, 1000)).toBe(messages)
  })

  test("drops the oldest turns first and keeps opening on a user turn", () => {
    const messages = [msg("user", 4000, "u1"), msg("assistant", 4000, "a1"), msg("user", 400, "u2"), msg("assistant", 400, "a2"), msg("user", 40, "now")]
    const kept = fitMessagesToBudget(messages, 400, 1)
    expect(kept[0].role).toBe("user")
    expect(kept[kept.length - 1].content).toStartWith("now")
    expect(kept.map(m => String(m.content).slice(0, 3))).not.toContain("u1x")
  })

  test("never drops the last two exchanges, even over budget", () => {
    const messages = [msg("user", 4000, "u1"), msg("assistant", 4000, "a1"), msg("user", 4000, "u2"), msg("assistant", 4000, "a2"), msg("user", 40, "now")]
    const kept = fitMessagesToBudget(messages, 10)
    // Last 4 are a1,u2,a2,now; the leading reply goes so history opens on a user turn.
    expect(kept.map(m => String(m.content).slice(0, 2))).toEqual(["u2", "a2", "no"])
  })

  test("a single oversized current message keeps its start and its end", () => {
    const giant = { role: "user" as const, content: "INICIO" + "x".repeat(200_000) + "FINAL" }
    const [kept] = fitMessagesToBudget([giant], 1000)
    expect(String(kept.content)).toStartWith("INICIO")
    expect(String(kept.content)).toEndWith("FINAL")
    expect(String(kept.content)).toContain("recortado para caber")
    expect(String(kept.content).length).toBeLessThan(10_000)
  })
})
