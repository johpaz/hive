import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { eventCameraPose } from "./cameraFocus";
import type { CanvasWorkEvent } from "@/stores/canvasStore";
import {
  enqueuePresentation,
  PRESENTATION_QUEUE_LIMIT,
  presentationDuration,
} from "../state/presentation";
import { toolVisualCategory } from "../state/toolVisuals";

function workEvent(id: string, phase: CanvasWorkEvent["phase"] = "delegated"): CanvasWorkEvent {
  return {
    eventId: id,
    phase,
    taskRef: id,
    taskName: "Tarea",
    actorId: "coordinator",
    targetId: "worker",
    timestamp: 1,
  };
}

describe("office event presentation", () => {
  it("frames both event participants from almost directly above", () => {
    const source = new Vector3(-8, 4, -3);
    const target = new Vector3(8, 4, 5);
    const pose = eventCameraPose(source, target);

    expect(pose.target.x).toBe(0);
    expect(pose.target.y).toBe(4);
    expect(pose.target.z).toBe(1);
    expect(pose.position.x).toBe(pose.target.x);
    expect(pose.position.y).toBeGreaterThan(pose.target.y + 15);
    expect(pose.position.z - pose.target.z).toBeCloseTo(0.8);
  });

  it("prioritizes alerts and limits the camera presentation queue", () => {
    let queue: CanvasWorkEvent[] = [];
    for (let index = 0; index < 5; index++) {
      queue = enqueuePresentation(queue, workEvent(`event-${index}`));
    }
    queue = enqueuePresentation(queue, workEvent("failure", "failed"));

    expect(queue).toHaveLength(PRESENTATION_QUEUE_LIMIT);
    expect(queue[0].eventId).toBe("failure");
    expect(presentationDuration("failed")).toBeGreaterThan(presentationDuration("delegated"));
  });

  it("deduplicates camera cues by event id", () => {
    const event = workEvent("same");
    expect(enqueuePresentation([event], event)).toEqual([event]);
  });

  it("maps live tools to stable, readable hologram families", () => {
    expect(toolVisualCategory("browser_open")).toBe("browser");
    expect(toolVisualCategory("apply_patch")).toBe("code");
    expect(toolVisualCategory("search_knowledge")).toBe("knowledge");
    expect(toolVisualCategory("slack_notify")).toBe("communication");
    expect(toolVisualCategory("custom_tool")).toBe("generic");
  });
});
