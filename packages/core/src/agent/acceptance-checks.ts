/**
 * acceptance-checks — deterministic acceptance checking, no LLM.
 *
 * Replaces the independent acceptance_verifier agent loop (which ran a full
 * agent-loop, up to 3 times, just to re-derive a verdict the worker's own
 * structured output already implies). This runs whatever deterministic
 * checkTool each criterion declares, inspects any artifact_id found in the
 * evidence, and applies cheap delivery gates — zero LLM calls.
 *
 * When nothing deterministic applies to a criterion, the result is
 * "unchecked", not a failure: that's exactly the case the coordinator's
 * closing turn (already paid for, via the delegation-group fan-in) is meant
 * to judge using this checks result plus the raw evidence.
 */

import { col } from "../storage/hive";
import type { AgentDoc } from "../storage/collections";
import type { AcceptanceCriterion } from "./run-store";
import { interpretCheckResult } from "./goal-runner";
import { inspectArtifact } from "../artifacts/store";
import { loadConfig } from "../config/loader";
import { logger } from "../utils/logger";

const log = logger.child("acceptance-checks");

export type CheckStatus = "passed" | "failed" | "unchecked";

export interface AcceptanceCheckResult {
  criterion_id: string;
  /** checkTool name, "artifact_inspect", "delivery_gate", or "none". */
  check: string;
  /** null when no deterministic check applied to this criterion. */
  met: boolean | null;
  detail: string;
}

export interface AcceptanceChecks {
  status: CheckStatus;
  results: AcceptanceCheckResult[];
  summary: string;
}

export function sanitizeDiagnostic(value: string, limit = 1000): string {
  return value
    .replace(/(api[_-]?key|token|authorization|secret)(["'=:\s]+)[^\s,}"']+/gi, "$1$2[REDACTED]")
    .slice(0, limit);
}

async function runCheckTool(criterion: AcceptanceCriterion, objective: string): Promise<AcceptanceCheckResult | null> {
  if (!criterion.checkTool) return null;
  try {
    const { executeToolBatch } = await import("../tool-runtime");
    const { createAllTools } = await import("../tools/index");
    const allTools = createAllTools(loadConfig());
    const toolDef = allTools.find((t) => t.name === criterion.checkTool);
    if (!toolDef) {
      log.warn(`[acceptance-checks] Check tool "${criterion.checkTool}" not found in the tool registry`);
      return { criterion_id: criterion.id, check: criterion.checkTool, met: null, detail: "Check tool not found in registry" };
    }
    const toolResults = await executeToolBatch({
      toolCalls: [{
        id: `check-${criterion.id}`,
        function: { name: criterion.checkTool, arguments: JSON.stringify({ goal: criterion.description || objective }) },
      }],
      allTools,
      toolConfig: {},
    });
    const result = toolResults[0];
    if (!result?.ok) {
      return { criterion_id: criterion.id, check: criterion.checkTool, met: false, detail: `Check tool failed: ${result?.error?.message ?? "unknown"}` };
    }
    const interpreted = interpretCheckResult(result.result);
    return { criterion_id: criterion.id, check: criterion.checkTool, met: interpreted.met, detail: interpreted.reason };
  } catch (err) {
    log.warn(`[acceptance-checks] Check tool "${criterion.checkTool}" errored: ${(err as Error).message}`);
    return { criterion_id: criterion.id, check: criterion.checkTool, met: false, detail: `Check tool error: ${(err as Error).message}` };
  }
}

async function artifactChecks(evidence: string[]): Promise<AcceptanceCheckResult[]> {
  const artifactIds = new Set<string>();
  for (const item of evidence) {
    for (const match of String(item).matchAll(/artifact_id:\s*["']?([0-9a-f-]{36})["']?/gi)) {
      if (match[1]) artifactIds.add(match[1]);
    }
  }
  const results: AcceptanceCheckResult[] = [];
  for (const artifactId of artifactIds) {
    const inspection = await inspectArtifact(artifactId);
    const ok = inspection.ok === true;
    results.push({
      criterion_id: "artifact",
      check: "artifact_inspect",
      met: ok,
      detail: ok ? `Artifact ${artifactId} verified` : `Artifact ${artifactId} inspection failed: ${JSON.stringify(inspection)}`,
    });
  }
  return results;
}

/** Matches the worker's own documented output contract (agent-catalog.ts buildSystemPrompt): "status: completed|needs_input|partial|failed". */
function selfDeclaredFailure(delivery: string): AcceptanceCheckResult | null {
  const match = delivery.match(/(?:^|\n)\s*-?\s*status\s*:\s*(completed|needs_input|partial|failed)/i);
  if (!match || match[1].toLowerCase() !== "failed") return null;
  return { criterion_id: "delivery", check: "delivery_gate", met: false, detail: "El worker declaró status: failed" };
}

export async function runAcceptanceChecks(input: {
  objective: string;
  acceptance?: AcceptanceCriterion[] | null;
  delivery: string;
  evidence?: string[];
}): Promise<AcceptanceChecks> {
  const criteria = input.acceptance?.length ? input.acceptance : [];
  const evidence = input.evidence ?? [];
  const results: AcceptanceCheckResult[] = [];

  if (!input.delivery || !input.delivery.trim()) {
    results.push({ criterion_id: "delivery", check: "delivery_gate", met: false, detail: "Empty delivery" });
  } else {
    const declared = selfDeclaredFailure(input.delivery);
    if (declared) results.push(declared);
  }

  for (const criterion of criteria) {
    const checked = await runCheckTool(criterion, input.objective);
    if (checked) results.push(checked);
  }

  results.push(...(await artifactChecks(evidence)));

  const anyFailed = results.some((r) => r.met === false);
  const anyPassed = results.some((r) => r.met === true);
  const status: CheckStatus = anyFailed ? "failed" : anyPassed ? "passed" : "unchecked";

  const summary = results.length
    ? results.map((r) => `${r.met === true ? "✅" : r.met === false ? "❌" : "◌"} ${r.check}: ${sanitizeDiagnostic(r.detail, 300)}`).join("\n")
    : "Sin checks determinísticos aplicables — requiere juicio del coordinador.";

  return { status, results, summary };
}

/** ACE counters live directly on the executor's AgentDoc row. */
export async function recordAgentOutcome(
  agentId: string | null | undefined,
  outcome: "helpful" | "harmful",
): Promise<void> {
  if (!agentId) return;
  const agents = await col<AgentDoc>("agents");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await agents.get(agentId);
    if (!current) return;
    try {
      await agents.put(agentId, {
        ...current.doc,
        helpful_count: (current.doc.helpful_count ?? 0) + (outcome === "helpful" ? 1 : 0),
        harmful_count: (current.doc.harmful_count ?? 0) + (outcome === "harmful" ? 1 : 0),
        updated_at: Date.now(),
      }, { expectedVersion: current.version });
      return;
    } catch {
      // Retry OCC conflicts; another outcome may have updated the same agent concurrently.
    }
  }
  log.warn(`[acceptance-checks] Could not update ACE counters for ${agentId}`);
}
