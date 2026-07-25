import { col, fromIndexable, nextId, toIndexable } from "../storage/hive";
import type {
  AgentDoc,
  VerificationDoc,
  VerificationVerdict,
} from "../storage/collections";
import type { AcceptanceCriterion } from "./run-store";
import type { RunEpoch } from "./run-epoch";
import { buildRunEpoch } from "./run-epoch";
import { prepareDelegation } from "./delegation-runtime";
import { runAgentIsolated } from "./agent-loop";
import { inspectArtifact } from "../artifacts/store";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";
import { logger } from "../utils/logger";

const log = logger.child("acceptance-verifier");

/** ACE counters now live directly on the executor's AgentDoc row — updated for any delegated agent, catalog-seeded or not. */
async function recordAgentVerdict(
  agentId: string | null | undefined,
  status: VerificationVerdict["status"],
): Promise<void> {
  if (!agentId) return;
  const agents = await col<AgentDoc>("agents");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await agents.get(agentId);
    if (!current) return;
    try {
      await agents.put(agentId, {
        ...current.doc,
        helpful_count: (current.doc.helpful_count ?? 0) + (status === "verified" ? 1 : 0),
        harmful_count: (current.doc.harmful_count ?? 0) + (status === "verified" ? 0 : 1),
        updated_at: Date.now(),
      }, { expectedVersion: current.version });
      return;
    } catch {
      // Retry OCC conflicts; another verification may have updated the same
      // agent concurrently.
    }
  }
  log.warn(`[acceptance-verifier] Could not update ACE counters for ${agentId}`);
}

export interface VerifyAgentDeliveryInput {
  runId: string;
  taskId?: string | null;
  executorAgentId: string;
  objective: string;
  acceptance?: AcceptanceCriterion[] | null;
  delivery: string;
  evidence?: string[];
  executorEpoch?: RunEpoch | null;
  mcpServerIds?: string[];
  mcpManager?: MCPClientManager | null;
}

export interface ExtractedVerdict {
  verdict: VerificationVerdict;
  parseFailure: boolean;
  parseError: string | null;
}

export function extractVerdict(raw: string, criteria: AcceptanceCriterion[]): ExtractedVerdict {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate) as VerificationVerdict;
    if (!["verified", "rejected", "needs_evidence"].includes(parsed.status)) throw new Error("invalid status");
    if (!Array.isArray(parsed.criterion_results)) throw new Error("criterion_results missing");
    const byId = new Map(parsed.criterion_results.map((result) => [result.criterion_id, result]));
    const normalized = criteria.map((criterion) => {
      const result = byId.get(criterion.id);
      return {
        criterion_id: criterion.id,
        met: result?.met === true,
        evidence: Array.isArray(result?.evidence) ? result.evidence.map(String) : [],
        check_used: typeof result?.check_used === "string" ? result.check_used : "independent_review",
        confidence: Math.max(0, Math.min(1, Number(result?.confidence) || 0)),
      };
    });
    const allMet = normalized.length > 0 && normalized.every((result) => result.met && result.evidence.length > 0);
    return {
      parseFailure: false,
      parseError: null,
      verdict: {
        status: parsed.status === "verified" && allMet ? "verified" : parsed.status === "verified" ? "needs_evidence" : parsed.status,
        criterion_results: normalized,
        summary: String(parsed.summary ?? ""),
        retry_guidance: parsed.retry_guidance == null ? null : String(parsed.retry_guidance),
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      },
    };
  } catch (err) {
    return {
      parseFailure: true,
      parseError: (err as Error).message,
      verdict: {
        status: "needs_evidence",
        criterion_results: criteria.map((criterion) => ({
          criterion_id: criterion.id,
          met: false,
          evidence: [],
          check_used: "verdict_parse_failed",
          confidence: 0,
        })),
        summary: `El verificador no produjo un veredicto estructurado válido: ${(err as Error).message}`,
        retry_guidance: "Reunir evidencia determinística y volver a verificar.",
        risks: ["No se autorizó reportar éxito."],
      },
    };
  }
}

function sanitizeDiagnostic(value: string, limit = 1000): string {
  return value
    .replace(/(api[_-]?key|token|authorization|secret)(["'=:\\s]+)[^\\s,}"']+/gi, "$1$2[REDACTED]")
    .slice(0, limit);
}

export async function persistVerification(input: {
  runId: string;
  taskId?: string | null;
  executorAgentId?: string | null;
  objective: string;
  acceptance: AcceptanceCriterion[];
  verdict: VerificationVerdict;
  executorEpoch?: RunEpoch | null;
  verifierEpoch?: RunEpoch | null;
  failureCode?: VerificationDoc["failure_code"];
  failureDetail?: string | null;
  rawOutputPreview?: string | null;
  verifierProvider?: string | null;
  verifierModel?: string | null;
  recordAce?: boolean;
}): Promise<VerificationDoc> {
  const c = await col<VerificationDoc>("verifications");
  const previous = await c.findBy("run_id", input.runId);
  const id = await nextId("verifications");
  const doc: VerificationDoc = {
    id,
    run_id: input.runId,
    task_id: toIndexable(input.taskId),
    executor_agent_id: toIndexable(input.executorAgentId),
    verifier_agent_id: "acceptance_verifier",
    objective: input.objective,
    acceptance_json: JSON.stringify(input.acceptance),
    verdict_json: JSON.stringify(input.verdict),
    status: input.verdict.status,
    attempt: previous.length + 1,
    executor_epoch_json: JSON.stringify(input.executorEpoch ?? null),
    verifier_epoch_json: JSON.stringify(input.verifierEpoch ?? null),
    failure_code: input.failureCode ?? null,
    failure_detail: input.failureDetail ? sanitizeDiagnostic(input.failureDetail) : null,
    raw_output_preview: input.rawOutputPreview ? sanitizeDiagnostic(input.rawOutputPreview) : null,
    verifier_provider: input.verifierProvider ?? null,
    verifier_model: input.verifierModel ?? null,
    created_at: Date.now(),
  };
  await c.put(id, doc, { expectedVersion: 0 });
  if (input.recordAce !== false) {
    await recordAgentVerdict(input.executorAgentId, input.verdict.status);
  }
  return doc;
}

export const VERIFIER_AGENT_ID = "acceptance_verifier";
const MAX_VERIFIER_OUTPUT_ATTEMPTS = 3;

export async function verifyAgentDelivery(input: VerifyAgentDeliveryInput): Promise<VerificationDoc> {
  const agents = await col<AgentDoc>("agents");
  const executorEntry = await agents.get(input.executorAgentId);
  if (!executorEntry) throw new Error(`Executor agent not found: ${input.executorAgentId}`);
  if (input.executorAgentId === VERIFIER_AGENT_ID) {
    throw new Error("The acceptance verifier cannot verify its own delivery");
  }

  const criteria = input.acceptance?.length
    ? input.acceptance
    : [{ id: "objective", description: input.objective }];
  const parentAgentId = fromIndexable(executorEntry.doc.parent_id) ?? input.executorAgentId;
  const parentEntry = await agents.get(parentAgentId);
  const awake = await prepareDelegation(VERIFIER_AGENT_ID, {
    workspace: executorEntry.doc.workspace,
    parentProviderId: fromIndexable(parentEntry?.doc.provider_id ?? "") || fromIndexable(executorEntry.doc.provider_id),
    parentModelId: fromIndexable(parentEntry?.doc.model_id ?? "") || fromIndexable(executorEntry.doc.model_id),
    executorModelId: fromIndexable(executorEntry.doc.model_id),
    mcpManager: input.mcpManager,
  });

  try {
    const suppliedEvidence = input.evidence ?? [];
    const artifactIds = new Set<string>();
    for (const item of suppliedEvidence) {
      const text = String(item);
      for (const match of text.matchAll(/artifact_id:\s*["']?([0-9a-f-]{36})["']?/gi)) {
        if (match[1]) artifactIds.add(match[1]);
      }
    }
    const artifactEvidence: string[] = [];
    for (const artifactId of artifactIds) {
      const inspection = await inspectArtifact(artifactId);
      artifactEvidence.push(`artifact_inspect(${artifactId}): ${JSON.stringify(inspection)}`);
      log.info(`[acceptance-verifier] Inspected managed artifact ${artifactId} (ok=${inspection.ok === true})`);
    }
    const evidence = [...suppliedEvidence, ...artifactEvidence];
    const task = `Auditá independientemente esta entrega.

OBJETIVO:
${input.objective}

CRITERIOS:
${criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}${criterion.checkTool ? ` (check sugerido: ${criterion.checkTool})` : ""}`).join("\n")}

ENTREGA DEL EJECUTOR:
${input.delivery}

EVIDENCIA ADJUNTA:
${evidence.map((item) => `- ${item}`).join("\n") || "- ninguna"}

No confíes en la afirmación del ejecutor. Usá únicamente tools read-only si necesitás inspeccionar artefactos. Si la evidencia contiene artifact_id, inspeccionalo con artifact_inspect; no lo reemplaces por una búsqueda de archivos en el workspace. Devolvé JSON estricto:
{"status":"verified|rejected|needs_evidence","criterion_results":[{"criterion_id":"...","met":true,"evidence":["..."],"check_used":"...","confidence":0.0}],"summary":"...","retry_guidance":null,"risks":[]}`;

    const verifierAgent = await agents.get(VERIFIER_AGENT_ID);
    const verifierEpoch = verifierAgent
      ? buildRunEpoch({
          provider: awake.providerId,
          model: awake.modelId,
          toolNames: awake.toolNames,
        })
      : null;

    let lastVerification: VerificationDoc | null = null;
    for (let attempt = 1; attempt <= MAX_VERIFIER_OUTPUT_ATTEMPTS; attempt++) {
      let raw = "";
      let runError: string | null = null;
      try {
        raw = await runAgentIsolated({
          agentId: VERIFIER_AGENT_ID,
          taskDescription: attempt === 1
            ? task
            : `${task}\n\nINTENTO DE FORMATO ${attempt}: la salida anterior fue inválida. Respondé con un único objeto JSON compacto, sin markdown ni texto adicional.`,
          threadId: `verify-${input.runId}-${Date.now()}-${attempt}`,
          mcpManager: input.mcpManager,
        });
      } catch (err) {
        runError = (err as Error).message;
        log.warn(`[acceptance-verifier] Independent run attempt ${attempt} failed closed: ${runError}`);
      }

      const extracted = extractVerdict(raw, criteria);
      const failureCode: VerificationDoc["failure_code"] = runError
        ? "verifier_error"
        : extracted.parseFailure
          ? "invalid_output"
          : null;
      const failureDetail = runError ?? extracted.parseError;

      lastVerification = await persistVerification({
        runId: input.runId,
        taskId: input.taskId,
        executorAgentId: input.executorAgentId,
        objective: input.objective,
        acceptance: criteria,
        verdict: extracted.verdict,
        executorEpoch: input.executorEpoch,
        verifierEpoch,
        failureCode,
        failureDetail,
        rawOutputPreview: raw,
        verifierProvider: awake.providerId,
        verifierModel: awake.modelId,
        recordAce: false,
      });

      if (!failureCode) {
        await recordAgentVerdict(input.executorAgentId, extracted.verdict.status);
        return lastVerification;
      }
    }

    if (!lastVerification) throw new Error("Acceptance verifier produced no result");
    // Every attempt failed on the verifier's side (it errored or never
    // produced parseable output). The delivery is still not verified — the
    // caller sees that in the returned verdict — but the executor is not the
    // one that misbehaved, so its ACE counters stay untouched: charging it
    // here punishes an agent for the auditor being broken.
    log.warn(`[acceptance-verifier] Verification of run ${input.runId} failed on the verifier side (${lastVerification.failure_code}) — not counted against ${input.executorAgentId}`);
    return lastVerification;
  } finally {
    await awake.release();
  }
}

export async function getVerifiedVerification(id: string, runId?: string): Promise<VerificationDoc | null> {
  const entry = await (await col<VerificationDoc>("verifications")).get(id);
  if (!entry || entry.doc.status !== "verified") return null;
  if (runId && entry.doc.run_id !== runId) return null;
  return entry.doc;
}
