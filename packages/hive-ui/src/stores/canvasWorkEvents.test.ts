import { describe, expect, it } from "vitest";
import type { CanvasWorkEvent } from "./canvasStore";
import { appendCanvasWorkEvent } from "./canvasWorkEvents";

function event(id: string): CanvasWorkEvent {
  return {
    eventId: id,
    phase: "delegated",
    taskRef: id,
    taskName: "Tarea",
    actorId: "queen",
    targetId: "worker",
    timestamp: 1,
  };
}

describe("canvas work event store", () => {
  it("deduplicates semantic events", () => {
    const item = event("event-1");
    expect(appendCanvasWorkEvent([item], item)).toEqual([item]);
  });

  it("keeps a bounded transient history", () => {
    let events: CanvasWorkEvent[] = [];
    for (let index = 0; index < 70; index++) {
      events = appendCanvasWorkEvent(events, event(`event-${index}`));
    }
    expect(events).toHaveLength(64);
    expect(events[0].eventId).toBe("event-6");
  });
});
