import { useCallback, useEffect, useRef } from "react";
import type { CanvasWorkEvent } from "@/stores/canvasStore";
import type { DeskModel } from "../state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";
import {
  enqueuePresentation,
  isAlertPhase,
  presentationDuration,
} from "../state/presentation";

/**
 * Serializa únicamente los hitos que toman la cámara. Las animaciones locales
 * pueden ocurrir en paralelo, pero el usuario siempre recibe una sola historia focal.
 */
export function SceneDirector({
  events,
  desks,
  coordinatorId,
}: {
  events: CanvasWorkEvent[];
  desks: DeskModel[];
  coordinatorId: string | null;
}) {
  const setActiveCue = useOffice3DStore((state) => state.setActiveCue);
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const queue = useRef<CanvasWorkEvent[]>([]);
  const active = useRef<CanvasWorkEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStates = useRef(new Map<string, DeskModel["state"]>());
  const statesInitialized = useRef(false);

  const pump = useCallback(function pumpNext() {
    if (active.current || queue.current.length === 0) return;
    const next = queue.current.shift() ?? null;
    active.current = next;
    setActiveCue(next);
    if (!next) return;
    timer.current = setTimeout(() => {
      active.current = null;
      setActiveCue(null);
      timer.current = null;
      pumpNext();
    }, presentationDuration(next.phase));
  }, [setActiveCue]);

  const schedule = useCallback((event: CanvasWorkEvent) => {
    if (isAlertPhase(event.phase) && active.current && !isAlertPhase(active.current.phase)) {
      if (timer.current) clearTimeout(timer.current);
      queue.current = enqueuePresentation(queue.current, active.current);
      active.current = null;
      setActiveCue(null);
    }
    queue.current = enqueuePresentation(queue.current, event);
    pump();
  }, [pump, setActiveCue]);

  useEffect(() => {
    if (!initialized.current) {
      events.forEach((event) => seen.current.add(event.eventId));
      initialized.current = true;
      return;
    }

    for (const event of events) {
      if (seen.current.has(event.eventId)) continue;
      seen.current.add(event.eventId);
      schedule(event);
    }
  }, [events, schedule]);

  useEffect(() => {
    if (!statesInitialized.current) {
      previousStates.current = new Map(desks.map((desk) => [desk.agent.id, desk.state]));
      statesInitialized.current = true;
      return;
    }

    for (const desk of desks) {
      const before = previousStates.current.get(desk.agent.id);
      if (desk.state === "stuck" && before !== "stuck") {
        schedule({
          eventId: `blocked:${desk.agent.id}:${Date.now()}`,
          phase: "blocked",
          taskRef: desk.taskId ?? `agent:${desk.agent.id}`,
          taskName: desk.currentTask ?? "Ejecución del agente",
          actorId: desk.agent.id,
          targetId: coordinatorId,
          detail: "El agente necesita atención",
          timestamp: Date.now(),
        });
      }
      previousStates.current.set(desk.agent.id, desk.state);
    }
  }, [coordinatorId, desks, schedule]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      setActiveCue(null);
    },
    [setActiveCue],
  );

  return null;
}
