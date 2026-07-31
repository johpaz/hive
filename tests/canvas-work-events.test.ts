import { describe, expect, test } from "bun:test";
import {
  emitDelegationStarted,
  emitWorkEvent,
  subscribeCanvas,
  unsubscribeCanvas,
} from "../packages/core/src/canvas/emitter";

function captureCanvasEvents(run: () => void) {
  const events: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> = [];
  const subscriber = {
    send(payload: string) {
      events.push(JSON.parse(payload));
    },
  };
  subscribeCanvas(subscriber);
  try {
    run();
  } finally {
    unsubscribeCanvas(subscriber);
  }
  return events;
}

describe("canvas work events", () => {
  test("delegation emits a semantic event with real participants", () => {
    const events = captureCanvasEvents(() => {
      emitDelegationStarted({
        workerId: "worker-1",
        parentAgentId: "queen-1",
        taskRef: "task-1",
        taskName: "Preparar informe",
      });
    });

    const work = events.find((event) => event.type === "canvas:work_event");
    expect(work?.data).toMatchObject({
      phase: "delegated",
      taskRef: "task-1",
      taskName: "Preparar informe",
      actorId: "queen-1",
      targetId: "worker-1",
    });
    expect(String(work?.data.eventId)).toContain("task-1:delegated");
  });

  test("review outcome identifies the coordinator and the worker it judged", () => {
    const events = captureCanvasEvents(() => {
      emitWorkEvent({
        phase: "review_passed",
        taskRef: "task-2",
        taskName: "Validar cambios",
        actorId: "queen-1",
        targetId: "worker-1",
      });
    });

    expect(events.find((event) => event.type === "canvas:work_event")?.data).toMatchObject({
      phase: "review_passed",
      actorId: "queen-1",
      targetId: "worker-1",
    });
  });

  test("outcomes preserve the phase and bound user-facing detail", () => {
    const detail = "x".repeat(300);
    const events = captureCanvasEvents(() => {
      emitWorkEvent({
        phase: "failed",
        taskRef: "task-3",
        taskName: "Tarea fallida",
        actorId: "worker-1",
        targetId: "queen-1",
        detail,
      });
    });

    const data = events[0]?.data;
    expect(data.phase).toBe("failed");
    expect(String(data.detail)).toHaveLength(180);
  });
});
