import { col, fromIndexable, nextId, toIndexable } from "../storage/hive";
import type {
  AgentDoc,
  SpecialistDoc,
  VerificationDoc,
  VerificationVerdict,
} from "../storage/collections";
import type { AcceptanceCriterion } from "./run-store";
import type { RunEpoch } from "./run-epoch";
import { buildRunEpoch } from "./run-epoch";
import { wakeSpecialist } from "./specialist-runtime";
import { runAgentIsolated } from "./agent-loop";
import type { MCPClientManager } from "@johpaz/hive-agents-mcp";
import { logger } from "../utils/logger";

const log = logger.child("acceptance-verifier");

async function recordSpecialistVerdict(
  specialistId: string | null | undefined,
  status: VerificationVerdict["status"],
): Promise<void> {
  if (!specialistId) return;
  const specialists = await col<SpecialistDoc>("specialists");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await specialists.get(specialistId);
    if (!current) return;
    try {
      await specialists.put(specialistId, {
        ...current.doc,
        helpful_count: current.doc.helpful_count + (status === "verified" ? 1 : 0),
        harmful_count: current.doc.harmful_count + (status === "verified" ? 0 : 1),
        updated_at: Date.now(),
      }, { expectedVersion: current.version });
      return;
    } catch {
      // Retry OCC conflicts; another verification may have updated the same
      // specialist concurrently.
    }
  }
  log.warn(`[acceptance-verifier] Could not update ACE counters for ${specialistId}`);
}

export interface VerifySpecialistDeliveryInput {
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

function extractVerdict(raw: string, criteria: AcceptanceCriterion[]): VerificationVerdict {
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
      status: parsed.status === "verified" && allMet ? "verified" : parsed.status === "verified" ? "needs_evidence" : parsed.status,
      criterion_results: normalized,
      summary: String(parsed.summary ?? ""),
      retry_guidance: parsed.retry_guidance == null ? null : String(parsed.retry_guidance),
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    };
  } catch (err) {
    return {
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
    };
  }
}

export async function persistVerification(input: {
  runId: string;
  taskId?: string | null;
  executorSpecialistId?: string | null;
  objective: string;
  acceptance: AcceptanceCriterion[];
  verdict: VerificationVerdict;
  executorEpoch?: RunEpoch | null;
  verifierEpoch?: RunEpoch | null;
}): Promise<VerificationDoc> {
  const c = await col<VerificationDoc>("verifications");
  const previous = await c.findBy("run_id", input.runId);
  const id = await nextId("verifications");
  const doc: VerificationDoc = {
    id,
    run_id: input.runId,
    task_id: toIndexable(input.taskId),
    executor_specialist_id: toIndexable(input.executorSpecialistId),
    verifier_specialist_id: "acceptance_verifier",
    objective: input.objective,
    acceptance_json: JSON.stringify(input.acceptance),
    verdict_json: JSON.stringify(input.verdict),
    status: input.verdict.status,
    attempt: previous.length + 1,
    executor_epoch_json: JSON.stringify(input.executorEpoch ?? null),
    verifier_epoch_json: JSON.stringify(input.verifierEpoch ?? null),
    created_at: Date.now(),
  };
  await c.put(id, doc, { expectedVersion: 0 });
  await recordSpecialistVerdict(input.executorSpecialistId, input.verdict.status);
  return doc;
}

export async function verifySpecialistDelivery(input: VerifySpecialistDeliveryInput): Promise<VerificationDoc> {
  const agents = await col<AgentDoc>("agents");
  const executorEntry = await agents.get(input.executorAgentId);
  if (!executorEntry) throw new Error(`Executor agent not found: ${input.executorAgentId}`);
  if (executorEntry.doc.specialist_id === "acceptance_verifier") {
    throw new Error("The acceptance verifier cannot verify its own delivery");
  }

  const criteria = input.acceptance?.length
    ? input.acceptance
    : [{ id: "objective", description: input.objective }];
  const parentAgentId = fromIndexable(executorEntry.doc.parent_id) ?? input.executorAgentId;
  const awake = await wakeSpecialist({
    specialistId: "acceptance_verifier",
    userId: executorEntry.doc.user_id,
    parentAgentId,
    workspace: executorEntry.doc.workspace,
    executorModelId: fromIndexable(executorEntry.doc.model_id),
    mcpManager: input.mcpManager,
  });

  try {
    const task = `Auditá independientemente esta entrega.

OBJETIVO:
${input.objective}

CRITERIOS:
${criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}${criterion.checkTool ? ` (check sugerido: ${criterion.checkTool})` : ""}`).join("\n")}

ENTREGA DEL EJECUTOR:
${input.delivery}

EVIDENCIA ADJUNTA:
${(input.evidence ?? []).map((item) => `- ${item}`).join("\n") || "- ninguna"}

No confíes en la afirmación del ejecutor. Usá únicamente tools read-only si necesitás inspeccionar artefactos. Devolvé JSON estricto:
{"status":"verified|rejected|needs_evidence","criterion_results":[{"criterion_id":"...","met":true,"evidence":["..."],"check_used":"...","confidence":0.0}],"summary":"...","retry_guidance":null,"risks":[]}`;

    let raw = "";
    try {
      raw = await runAgentIsolated({
        agentId: awake.workerId,
        taskDescription: task,
        threadId: `verify-${input.runId}-${Date.now()}`,
        mcpManager: input.mcpManager,
      });
    } catch (err) {
      log.warn(`[acceptance-verifier] Independent run failed closed: ${(err as Error).message}`);
      raw = "";
    }
    const verdict = extractVerdict(raw, criteria);
    const verifierAgent = await agents.get(awake.workerId);
    const verifierEpoch = verifierAgent
      ? buildRunEpoch({
          provider: fromIndexable(verifierAgent.doc.provider_id) ?? "",
          model: fromIndexable(verifierAgent.doc.model_id) ?? "",
          toolNames: awake.toolNames,
        })
      : null;
    return await persistVerification({
      runId: input.runId,
      taskId: input.taskId,
      executorSpecialistId: executorEntry.doc.specialist_id,
      objective: input.objective,
      acceptance: criteria,
      verdict,
      executorEpoch: input.executorEpoch,
      verifierEpoch,
    });
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
