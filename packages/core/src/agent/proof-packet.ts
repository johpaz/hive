/**
 * Proof packets — compressed evidence artifact for a completed goal/project
 * run (harness-engineering "proof" practice): what was intended, what was
 * checked, what evidence backs the verdict, and known limits. Written once
 * per run by the goal_run / project_task executors after verification, so a
 * reviewer doesn't have to replay the whole run to trust its outcome.
 */

import { col, nextId } from "../storage/hive";
import type { ProofPacketDoc } from "../storage/collections";
import type { AcceptanceResult } from "./goal-runner";
import type { RunEpoch } from "./run-epoch";
import { logger } from "../utils/logger";

const log = logger.child("proof-packet");

export interface BuildProofPacketInput {
  runId: string;
  agentId: string;
  intendedOutcome: string;
  met: boolean;
  /** Per-criterion verdicts when acceptance criteria were set; falls back to a single-entry summary otherwise. */
  acceptanceResults?: AcceptanceResult[];
  checksRun: string[];
  evidence: string[];
  knownLimits?: string | null;
  epoch?: RunEpoch | null;
}

export async function buildProofPacket(input: BuildProofPacketInput): Promise<ProofPacketDoc> {
  const id = await nextId("proofPackets");
  const acceptanceResults: AcceptanceResult[] =
    input.acceptanceResults ?? [{ id: "goal", description: input.intendedOutcome, met: input.met, evidence: input.evidence.join("; ") || "n/a" }];

  const doc: ProofPacketDoc = {
    id,
    run_id: input.runId,
    agent_id: input.agentId,
    intended_outcome: input.intendedOutcome,
    acceptance_results_json: JSON.stringify(acceptanceResults),
    checks_run_json: JSON.stringify(input.checksRun),
    evidence_json: JSON.stringify(input.evidence),
    known_limits: input.knownLimits ?? null,
    epoch_json: input.epoch ? JSON.stringify(input.epoch) : null,
    met: input.met,
    created_at: Date.now(),
  };

  const c = await col<ProofPacketDoc>("proofPackets");
  await c.put(id, doc, { expectedVersion: 0 });
  log.info(`[buildProofPacket] Packet ${id} written for run ${input.runId} (met=${input.met})`);
  return doc;
}

export async function findProofPacketsByRun(runId: string): Promise<ProofPacketDoc[]> {
  const c = await col<ProofPacketDoc>("proofPackets");
  const entries = await c.findBy("run_id", runId);
  return entries.map((e) => e.doc);
}
