process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getDelegationGroup,
  recordDelegationOutcome,
  registerDelegatedTask,
  sealDelegationGroup,
  setDelegationSummaryEnqueuer,
} from "../packages/core/src/gateway/delegation-groups";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";

beforeEach(() => closeHiveDb());
afterEach(() => {
  setDelegationSummaryEnqueuer(null);
  closeHiveDb();
});

describe("delegation group join", () => {
  test("waits for every terminal worker and enqueues one factual coordinator synthesis", async () => {
    const enqueued: Array<{ content: string; key: string }> = [];
    setDelegationSummaryEnqueuer(async (_group, content, key) => {
      enqueued.push({ content, key });
      return { id: "summary-job-1" };
    });

    await Promise.all([
      registerDelegatedTask({
        turnId: "turn-join",
        taskId: "task-a",
        threadId: "thread",
        channel: "telegram",
        userId: "user",
        sessionId: "chat",
        coordinatorAgentId: "coordinator",
      }),
      registerDelegatedTask({
        turnId: "turn-join",
        taskId: "task-b",
        threadId: "thread",
        channel: "telegram",
        userId: "user",
        sessionId: "chat",
        coordinatorAgentId: "coordinator",
      }),
    ]);
    await sealDelegationGroup("turn-join");
    expect(enqueued).toHaveLength(0);

    await recordDelegationOutcome({
      turnId: "turn-join",
      taskId: "task-a",
      jobId: "job-a",
      workerId: "agent-a",
      taskName: "consultar API",
      ok: true,
      result: { content: "200 OK", verification_id: "verify-a" },
    });
    expect(enqueued).toHaveLength(0);

    await Promise.all([
      recordDelegationOutcome({
        turnId: "turn-join",
        taskId: "task-b",
        jobId: "job-b",
        workerId: "agent-b",
        taskName: "revisar interfaz",
        ok: false,
        error: "evidencia insuficiente",
      }),
      recordDelegationOutcome({
        turnId: "turn-join",
        taskId: "task-b",
        jobId: "job-b",
        workerId: "agent-b",
        taskName: "revisar interfaz",
        ok: false,
        error: "evidencia insuficiente",
      }),
    ]);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.key).toBe("delegation-summary:turn-join");
    expect(enqueued[0]?.content).toContain("verify-a");
    expect(enqueued[0]?.content).toContain("evidencia insuficiente");
    expect((await getDelegationGroup("turn-join"))?.status).toBe("notified");
  });
});
