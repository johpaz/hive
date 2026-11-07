/**
 * Variantes de compactación a comparar.
 *
 *  - legacy:             el comportamiento ANTERIOR de compaction.ts: prompt de «3–5 oraciones»,
 *                        300 caracteres por mensaje, los últimos 30 mensajes de TODO el historial
 *                        y sin ver el resumen anterior (cada compactación olvida lo que quedó atrás).
 *  - legacy-incremental: el mismo prompt y límites, pero incorporando el resumen anterior y solo lo
 *                        nuevo. Aísla cuánto del cambio viene de la corrección incremental.
 *  - handoff-v1:         traspaso de seis campos con el prompt de la primera versión (sin reglas de conservación).
 *  - handoff:            el actual: traspaso de seis campos (handoff.ts), con sus reglas, límites nuevos e incremental.
 *
 * `legacy` y `legacy-incremental` reconstruyen código que ya no existe, así que su prompt vive aquí,
 * copiado del original. `handoff` usa las funciones reales de handoff.ts y los límites reales.
 */

import { COMPACTION_LIMITS, findCompactionCutIndex, renderTranscript } from "../../packages/core/src/agent/compaction"
import type { StoredMessage } from "../../packages/core/src/agent/conversation-store"
import {
  HANDOFF_SYSTEM_PROMPT,
  buildHandoffPrompt,
  parseHandoff,
  renderHandoff,
  type Handoff,
} from "../../packages/core/src/agent/handoff"
import type { Scenario } from "./scenario"

/** Una llamada al modelo: sistema y usuario en, texto fuera. */
export type Llm = (system: string, user: string) => Promise<string>

export interface VariantResult {
  /** El texto que verá la siguiente instancia tras la última compactación. */
  summary: string
  /** Hasta qué mensaje (exclusivo) llegó la última compactación. */
  finalCutIndex: number
  calls: number
  failures: number
}

export interface Variant {
  name: string
  description: string
  run(scenario: Scenario, llm: Llm): Promise<VariantResult>
}

const LEGACY_MAX_TRANSCRIPT_MSGS = 30
const LEGACY_MAX_MSG_CHARS = 300

const LEGACY_SYSTEM =
  "You are a conversation summarizer. Create a concise summary preserving: " +
  "user preferences, decisions made, important facts, tool results, and context needed to continue."

function toRows(scenario: Scenario, upTo: number): StoredMessage[] {
  return scenario.messages.slice(0, upTo).map((m) => ({
    id: m.id,
    thread_id: "bench",
    channel: "bench",
    role: m.role,
    source: "message",
    content: m.content,
    tool_calls_json: null,
    tool_call_id: null,
    reasoning_content: null,
    content_multimodal: null,
    token_count: Math.ceil(m.content.length / 4),
    created_at: 0,
  }))
}

/** Tras cada tramo: el corte limpio y lo que hay que resumir hasta él. */
function cutAfter(scenario: Scenario, segmentEnd: number) {
  const rows = toRows(scenario, segmentEnd)
  const cut = findCompactionCutIndex(rows, COMPACTION_LIMITS.keepLastMessages)
  return { rows, cut, toSummarize: rows.slice(0, Math.max(0, cut)) }
}

function legacyVariant(incremental: boolean): Variant {
  return {
    name: incremental ? "legacy-incremental" : "legacy",
    description: incremental
      ? "Prompt de 3–5 oraciones, pero incorporando el resumen anterior y solo lo nuevo."
      : "Comportamiento anterior: 3–5 oraciones, últimos 30 mensajes de todo el historial, sin resumen previo.",
    async run(scenario, llm) {
      let summary = ""
      let lastId = 0
      let finalCutIndex = 0
      let calls = 0
      let failures = 0
      for (const end of scenario.segmentEnds) {
        const { toSummarize } = cutAfter(scenario, end)
        if (toSummarize.length === 0) continue
        const fresh = incremental ? toSummarize.filter((m) => m.id > lastId) : toSummarize
        if (fresh.length === 0) continue
        const transcript = renderTranscript(fresh.slice(-LEGACY_MAX_TRANSCRIPT_MSGS), LEGACY_MAX_MSG_CHARS)
        const user =
          incremental && summary
            ? `Existing summary of the earlier conversation:\n${summary}\n\nUpdate it with these ${fresh.length} new messages, in 3-5 sentences:\n\n${transcript}`
            : `Summarize this conversation (${toSummarize.length} messages) in 3-5 sentences:\n\n${transcript}`
        calls++
        try {
          const out = (await llm(LEGACY_SYSTEM, user)).trim()
          if (out) {
            summary = out
            lastId = toSummarize[toSummarize.length - 1]!.id
            finalCutIndex = toSummarize.length
          }
        } catch {
          failures++
        }
      }
      return { summary, finalCutIndex, calls, failures }
    },
  }
}

/** El prompt de usuario de la primera versión del traspaso, tal como se evaluó (sin reglas de conservación). */
function buildHandoffPromptV1(input: { transcript: string; messageCount: number; previous?: string | null }): string {
  const previous = input.previous?.trim()
  return [
    previous ? `Previous handoff (carry forward what is still true; drop what is obsolete):\n${previous}\n` : "",
    `New conversation to fold in (${input.messageCount} messages):\n${input.transcript}\n`,
    "Reply with ONLY this JSON object (same language as the conversation; one short line per item):",
    "{",
    '  "objective": "one line: the result the user wants",',
    '  "facts": ["established facts, kept EXACT: paths, ids, values, names, errors, user preferences and decisions"],',
    '  "changes": ["what was changed or created, and whether it was verified"],',
    '  "verification": ["checks run and their outcome"],',
    '  "dead_ends": ["approaches that failed and must not be repeated, with why"],',
    '  "plan": ["remaining steps in order; the first is the immediate next step"]',
    "}",
    "Use [] for a field with nothing to report. Never invent facts; separate what was observed from what is only an idea.",
  ].filter(Boolean).join("\n")
}

function handoffVariant(name: string, description: string, buildPrompt: typeof buildHandoffPrompt): Variant {
  return {
  name,
  description,
  async run(scenario, llm) {
    let previous: Handoff | null = null
    let previousText = ""
    let lastId = 0
    let finalCutIndex = 0
    let calls = 0
    let failures = 0
    for (const end of scenario.segmentEnds) {
      const { toSummarize } = cutAfter(scenario, end)
      const fresh = toSummarize.filter((m) => m.id > lastId)
      if (fresh.length === 0) continue
      const capped = fresh.slice(-COMPACTION_LIMITS.maxTranscriptMsgs)
      const rendered = renderTranscript(capped, COMPACTION_LIMITS.maxMsgChars)
      const transcript =
        rendered.length > COMPACTION_LIMITS.maxTranscriptChars
          ? rendered.slice(-COMPACTION_LIMITS.maxTranscriptChars)
          : rendered
      const user = buildPrompt({
        transcript,
        messageCount: capped.length,
        previous: previous ? renderHandoff(previous) : previousText || null,
      })
      calls++
      try {
        const raw = (await llm(HANDOFF_SYSTEM_PROMPT, user)).trim()
        if (!raw) continue
        const parsed = parseHandoff(raw)
        if (!parsed && /^[`{[]/.test(raw)) {
          failures++ // JSON roto: el hilo queda sin compactar, igual que en compaction.ts
          continue
        }
        previous = parsed
        previousText = parsed ? "" : raw
        lastId = toSummarize[toSummarize.length - 1]!.id
        finalCutIndex = toSummarize.length
      } catch {
        failures++
      }
    }
    const summary = previous ? renderHandoff(previous) : previousText
    return { summary, finalCutIndex, calls, failures }
  },
  }
}

export const VARIANTS: Variant[] = [
  legacyVariant(false),
  legacyVariant(true),
  handoffVariant("handoff-v1", "Traspaso de seis campos con el prompt de la primera versión.", buildHandoffPromptV1),
  handoffVariant("handoff", "Actual: traspaso de seis campos con reglas de conservación, límites nuevos e incremental.", buildHandoffPrompt),
]
