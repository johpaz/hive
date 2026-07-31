import type { CanvasWorkEvent, CanvasWorkPhase } from "@/stores/canvasStore";

export const PRESENTATION_QUEUE_LIMIT = 3;

const ALERT_PHASES = new Set<CanvasWorkPhase>(["failed", "aborted", "review_failed", "blocked"]);

export function presentationDuration(phase: CanvasWorkPhase): number {
  return ALERT_PHASES.has(phase) ? 4200 : phase === "completed" ? 3200 : 2800;
}

export function isAlertPhase(phase: CanvasWorkPhase): boolean {
  return ALERT_PHASES.has(phase);
}

export function enqueuePresentation(
  queue: CanvasWorkEvent[],
  event: CanvasWorkEvent,
): CanvasWorkEvent[] {
  if (queue.some((queued) => queued.eventId === event.eventId)) return queue;
  const next = isAlertPhase(event.phase) ? [event, ...queue] : [...queue, event];
  return next.slice(0, PRESENTATION_QUEUE_LIMIT);
}

export function workPhaseLabel(phase: CanvasWorkPhase): string {
  switch (phase) {
    case "delegated":
      return "Delegando trabajo";
    case "review_passed":
      return "Revisión aprobada";
    case "review_failed":
      return "Revisión no aprobada";
    case "completed":
      return "Entregando resultado";
    case "failed":
      return "Trabajo fallido";
    case "aborted":
      return "Trabajo interrumpido";
    case "blocked":
      return "Agente bloqueado";
  }
}

export function workPhaseTone(phase: CanvasWorkPhase): "work" | "review" | "done" | "alert" {
  if (phase === "failed" || phase === "aborted" || phase === "review_failed") return "alert";
  if (phase === "completed" || phase === "review_passed") return "done";
  return "work";
}
