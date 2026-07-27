import type { CanvasWorkEvent } from "./canvasStore";

export function appendCanvasWorkEvent(
  current: CanvasWorkEvent[],
  event: CanvasWorkEvent,
): CanvasWorkEvent[] {
  if (current.some((existing) => existing.eventId === event.eventId)) return current;
  return [...current, event].slice(-64);
}
