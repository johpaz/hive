import { col } from "../storage/hive";
import type {
  DelegationGroupDoc,
  DelegationGroupOutcome,
} from "../storage/collections";
import { logger } from "../utils/logger";
import { publishNarration } from "../events/narration";

const log = logger.child("delegation-groups");
const MAX_RETRIES = 8;

export type DelegationSummaryEnqueuer = (
  group: DelegationGroupDoc,
  content: string,
  idempotencyKey: string,
) => Promise<{ id: string }>;

let summaryEnqueuer: DelegationSummaryEnqueuer | null = null;

export function setDelegationSummaryEnqueuer(enqueuer: DelegationSummaryEnqueuer | null): void {
  summaryEnqueuer = enqueuer;
}

function taskIds(group: DelegationGroupDoc): string[] {
  return JSON.parse(group.task_ids_json || "[]");
}

function outcomes(group: DelegationGroupDoc): DelegationGroupOutcome[] {
  return JSON.parse(group.outcomes_json || "[]");
}

async function mutate(
  groupId: string,
  fn: (doc: DelegationGroupDoc) => DelegationGroupDoc,
): Promise<DelegationGroupDoc> {
  const groups = await col<DelegationGroupDoc>("delegationGroups");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await groups.get(groupId);
    if (!current) throw new Error(`Delegation group not found: ${groupId}`);
    const next = fn(current.doc);
    try {
      await groups.put(groupId, next, { expectedVersion: current.version });
      return next;
    } catch {
      // optimistic concurrency conflict
    }
  }
  throw new Error(`Delegation group contention: ${groupId}`);
}

export async function registerDelegatedTask(input: {
  turnId: string;
  taskId: string;
  threadId: string;
  channel?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  coordinatorAgentId?: string | null;
}): Promise<DelegationGroupDoc> {
  const groups = await col<DelegationGroupDoc>("delegationGroups");
  const existing = await groups.get(input.turnId);
  if (!existing) {
    const now = Date.now();
    const created: DelegationGroupDoc = {
      id: input.turnId,
      turn_id: input.turnId,
      thread_id: input.threadId,
      channel: input.channel ?? "",
      user_id: input.userId ?? "",
      session_id: input.sessionId ?? "",
      coordinator_agent_id: input.coordinatorAgentId ?? "",
      status: "open",
      task_ids_json: JSON.stringify([input.taskId]),
      outcomes_json: "[]",
      summary_job_id: null,
      created_at: now,
      sealed_at: null,
      ready_at: null,
      notified_at: null,
    };
    try {
      await groups.put(input.turnId, created, { expectedVersion: 0 });
      return created;
    } catch {
      // Another parallel task created the group; append below.
    }
  }

  return mutate(input.turnId, (group) => {
    if (group.status !== "open") {
      throw new Error(`Delegation group ${input.turnId} is already sealed`);
    }
    const ids = taskIds(group);
    if (!ids.includes(input.taskId)) ids.push(input.taskId);
    return { ...group, task_ids_json: JSON.stringify(ids) };
  });
}

export async function getDelegationGroup(turnId: string): Promise<DelegationGroupDoc | null> {
  return (await (await col<DelegationGroupDoc>("delegationGroups")).get(turnId))?.doc ?? null;
}

function isComplete(group: DelegationGroupDoc): boolean {
  const expected = new Set(taskIds(group));
  const completed = new Set(outcomes(group).map((outcome) => outcome.task_id));
  return expected.size > 0 && [...expected].every((id) => completed.has(id));
}

function summarize(value: unknown, maxLen = 800): unknown {
  if (typeof value !== "string") return value;
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

function summaryPrompt(group: DelegationGroupDoc): string {
  const factual = outcomes(group).map((outcome) => {
    const result = outcome.result as { content?: unknown; acceptance?: unknown; checks?: { status?: string; summary?: string } } | null;
    return {
      task_id: outcome.task_id,
      worker_id: outcome.worker_id,
      task: outcome.task_name,
      ok: outcome.ok,
      content: summarize(result?.content ?? outcome.result),
      acceptance: result?.acceptance ?? null,
      checks: result?.checks ? { status: result.checks.status, summary: summarize(result.checks.summary) } : null,
      error: outcome.error,
    };
  });
  // No manual framing here — persisted with source:"delegation_summary" and
  // framed at serialization time by formatInternalEvent (conversation-store.ts).
  return [
    "Todas las tareas delegadas de este turno alcanzaron estado terminal.",
    "Para cada una, comprueba la entrega contra sus criterios de aceptación (`acceptance`):",
    '- checks.status="passed" → verificado determinísticamente, aceptá.',
    '- checks.status="failed" → NO cumplió (ok=false). No lo reportes como éxito.',
    '- checks.status="unchecked" o ausente → juzgalo tú con el contenido y la evidencia adjunta.',
    "Si una entrega no cumple sus criterios: usa `task_revise` con el task_id y un feedback concreto, o arreglala tú si es trivial y tienes las tools. No inventes trabajo ni evidencia, y no declares éxito para ok=false.",
    "Si todas cumplen, escribe UNA sola respuesta final para el usuario, en lenguaje natural: nunca expongas task_id, worker_id, nombres de tools ni JSON crudo.",
    JSON.stringify(factual),
  ].join("\n\n");
}

async function finalizeIfReady(groupId: string): Promise<DelegationGroupDoc> {
  let group = await getDelegationGroup(groupId);
  if (!group || group.status === "open" || group.status === "notified" || !isComplete(group)) {
    return group!;
  }
  if (group.status === "sealed") {
    group = await mutate(groupId, (current) => {
      if (current.status !== "sealed" || !isComplete(current)) return current;
      return { ...current, status: "ready", ready_at: Date.now() };
    });
  }
  if (group.status !== "ready") return group;
  if (!summaryEnqueuer) {
    log.warn(`Group ${groupId} is ready but no summary enqueuer is registered`);
    return group;
  }

  const groups = await col<DelegationGroupDoc>("delegationGroups");
  let claimed = false;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await groups.get(groupId);
    if (!current) return group;
    if (current.doc.status !== "ready" || current.doc.summary_job_id !== null) {
      return current.doc;
    }
    try {
      await groups.put(groupId, {
        ...current.doc,
        summary_job_id: "__claim__",
      }, { expectedVersion: current.version });
      group = { ...current.doc, summary_job_id: "__claim__" };
      claimed = true;
      break;
    } catch {
      // another terminal hook is racing us
    }
  }
  if (!claimed) return (await getDelegationGroup(groupId))!;

  let job: { id: string };
  try {
    job = await summaryEnqueuer(
      group,
      summaryPrompt(group),
      `delegation-summary:${group.id}`,
    );
  } catch (error) {
    await mutate(groupId, (current) => current.summary_job_id === "__claim__"
      ? { ...current, summary_job_id: null }
      : current);
    throw error;
  }
  group = await mutate(groupId, (current) => {
    if (current.status === "notified") return current;
    return {
      ...current,
      status: "notified",
      summary_job_id: job.id,
      notified_at: Date.now(),
    };
  });
  await publishNarration({
    turnId: group.turn_id,
    threadId: group.thread_id,
    channel: group.channel,
    userId: group.user_id,
    sessionId: group.session_id,
    agentId: group.coordinator_agent_id,
    agentName: "Coordinador",
    kind: "group_ready",
    status: "done",
    label: "Todas las entregas fueron revisadas; el coordinador prepara una única respuesta final",
    dedupeKey: "delegation_group_ready",
  });
  return group;
}

export async function sealDelegationGroup(turnId: string): Promise<DelegationGroupDoc | null> {
  const existing = await getDelegationGroup(turnId);
  if (!existing) return null;
  if (existing.status === "open") {
    await mutate(turnId, (group) => group.status === "open"
      ? { ...group, status: "sealed", sealed_at: Date.now() }
      : group);
  }
  return finalizeIfReady(turnId);
}

export async function recordDelegationOutcome(input: {
  turnId: string;
  taskId: string;
  jobId: string;
  workerId: string;
  taskName: string;
  ok: boolean;
  result?: unknown;
  error?: string | null;
}): Promise<DelegationGroupDoc | null> {
  const existing = await getDelegationGroup(input.turnId);
  if (!existing) return null;
  await mutate(input.turnId, (group) => {
    const current = outcomes(group);
    if (current.some((outcome) => outcome.task_id === input.taskId)) return group;
    current.push({
      task_id: input.taskId,
      job_id: input.jobId,
      worker_id: input.workerId,
      task_name: input.taskName,
      ok: input.ok,
      result: input.result ?? null,
      error: input.error ?? null,
      finished_at: Date.now(),
    });
    return { ...group, outcomes_json: JSON.stringify(current) };
  });
  return finalizeIfReady(input.turnId);
}
