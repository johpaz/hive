/**
 * Tests for agent/proof-packet.ts — buildProofPacket persistence, and
 * run-store.ts's acceptance_json/epoch_json round-trip.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { createRun, deserializeAcceptance, deserializeEpoch } from "../packages/core/src/agent/run-store";
import { buildProofPacket, findProofPacketsByRun } from "../packages/core/src/agent/proof-packet";
import { buildRunEpoch } from "../packages/core/src/agent/run-epoch";
import { persistVerification } from "../packages/core/src/agent/acceptance-verifier";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("run-store: acceptance + epoch round-trip", () => {
  test("createRun persists acceptance criteria and epoch, both deserializable", async () => {
    const epoch = buildRunEpoch({ provider: "anthropic", model: "claude-x", toolNames: ["search", "exec"] });
    const run = await createRun({
      thread_id: "t1",
      agent_id: "a1",
      user_id: "u1",
      channel: null,
      kind: "goal",
      max_iterations: 20,
      acceptance: [
        { id: "c1", description: "responds in Spanish" },
        { id: "c2", description: "calls the search tool", checkTool: "search" },
      ],
      epoch,
    });

    const acceptance = deserializeAcceptance(run);
    expect(acceptance).not.toBeNull();
    expect(acceptance!.length).toBe(2);
    expect(acceptance![1].checkTool).toBe("search");

    const deserializedEpoch = deserializeEpoch(run);
    expect(deserializedEpoch).toEqual(epoch);
  });

  test("createRun without acceptance/epoch deserializes to null", async () => {
    const run = await createRun({
      thread_id: "t2",
      agent_id: "a1",
      user_id: "u1",
      channel: null,
      kind: "chat",
      max_iterations: 20,
    });

    expect(deserializeAcceptance(run)).toBeNull();
    expect(deserializeEpoch(run)).toBeNull();
  });
});

describe("proof-packet: buildProofPacket", () => {
  test("persists a packet with default single-entry acceptance when none is given", async () => {
    const verification = await persistVerification({
      runId: "run-1",
      executorSpecialistId: "api_operator",
      objective: "send the weekly report",
      acceptance: [{ id: "goal", description: "send the weekly report" }],
      verdict: {
        status: "verified",
        criterion_results: [{
          criterion_id: "goal",
          met: true,
          evidence: ["readback confirms delivery"],
          check_used: "readback",
          confidence: 1,
        }],
        summary: "Delivery independently confirmed.",
        retry_guidance: null,
        risks: [],
      },
    });
    const packet = await buildProofPacket({
      runId: "run-1",
      agentId: "a1",
      intendedOutcome: "send the weekly report",
      met: true,
      checksRun: ["llm_verifier"],
      evidence: ["report sent to #ops"],
      verificationId: verification.id,
      specialistId: "api_operator",
    });

    expect(packet.run_id).toBe("run-1");
    expect(packet.met).toBe(true);
    const acceptance = JSON.parse(packet.acceptance_results_json);
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0].met).toBe(true);

    const found = await findProofPacketsByRun("run-1");
    expect(found.length).toBe(1);
    expect(found[0].id).toBe(packet.id);
    expect(packet.verification_id).toBe(verification.id);
  });

  test("fails closed when success has no independent verification", async () => {
    await expect(buildProofPacket({
      runId: "run-unverified",
      agentId: "a1",
      intendedOutcome: "effect happened",
      met: true,
      checksRun: [],
      evidence: ["executor says it happened"],
    })).rejects.toThrow("requires an independent verification_id");
  });

  test("persists per-criterion acceptance results when provided", async () => {
    const packet = await buildProofPacket({
      runId: "run-2",
      agentId: "a1",
      intendedOutcome: "onboard the new client",
      met: false,
      acceptanceResults: [
        { id: "c1", description: "created workspace", met: true, evidence: "workspace ws-9 created" },
        { id: "c2", description: "sent welcome email", met: false, evidence: "SMTP timeout" },
      ],
      checksRun: ["create_workspace", "send_email"],
      evidence: ["workspace ws-9 created", "SMTP timeout"],
      knownLimits: "email delivery not retried within this run",
    });

    expect(packet.met).toBe(false);
    const acceptance = JSON.parse(packet.acceptance_results_json);
    expect(acceptance).toHaveLength(2);
    expect(acceptance.filter((a: { met: boolean }) => a.met)).toHaveLength(1);
    expect(packet.known_limits).toContain("not retried");
  });
});
