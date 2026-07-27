import { useEffect, useRef, useState } from "react";
import type { GraphNode } from "@/stores/canvasStore";
import type { CanvasWorkEvent } from "@/stores/canvasStore";
import type { DeskModel, DeskState, OfficeInteraction } from "@/modules/office3d/state/useOfficeModel";
import { humanizeTool } from "@/modules/office3d/state/toolLabels";
import { workPhaseLabel, workPhaseTone } from "../state/presentation";

export interface TickerEvent {
  id: number;
  time: string;
  text: string;
  color: string;
  kind: "info" | "work" | "warn" | "done";
}

let eventSeq = 0;

interface PrevDeskInfo {
  state: DeskState;
}

function stateEvent(desk: DeskModel, next: DeskState): Omit<TickerEvent, "id" | "time"> | null {
  if (next === "tool_call" && !desk.currentTask)
    return { text: `${desk.agent.name} · ${humanizeTool(desk.currentTool) ?? "Ejecutando herramienta"}`, color: desk.color, kind: "work" };
  if (next === "thinking" && !desk.currentTask) return { text: `${desk.agent.name} está pensando…`, color: desk.color, kind: "info" };
  if (next === "stuck") return { text: `${desk.agent.name} necesita ayuda`, color: "#f87171", kind: "warn" };
  return null;
}

/**
 * Historial derivado únicamente del estado que llega por WebSocket:
 * edges para transferencias y node_update para actividad de agentes.
 */
export function useEventFeed(
  desks: DeskModel[],
  interactions: OfficeInteraction[],
  coordinator: GraphNode | null,
  workEvents: CanvasWorkEvent[],
): TickerEvent[] {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const prev = useRef<Map<string, PrevDeskInfo>>(new Map());
  const seenWorkEvents = useRef(new Set<string>());
  const initialized = useRef(false);

  useEffect(() => {
    const prevMap = prev.current;
    const deskById = new Map(desks.map((desk) => [desk.agent.id, desk]));
    const fresh: TickerEvent[] = [];
    const now = new Date().toLocaleTimeString("es", { hour12: false });
    const nameOf = (id: string) =>
      id === coordinator?.id
        ? coordinator.name
        : deskById.get(id)?.agent.name ?? id;

    if (initialized.current) {
      for (const event of workEvents) {
        if (seenWorkEvents.current.has(event.eventId)) continue;
        seenWorkEvents.current.add(event.eventId);
        const tone = workPhaseTone(event.phase);
        fresh.push({
          id: ++eventSeq,
          time: new Date(event.timestamp).toLocaleTimeString("es", { hour12: false }),
          text: `${workPhaseLabel(event.phase)} · ${nameOf(event.actorId)}${event.targetId ? ` → ${nameOf(event.targetId)}` : ""}: «${event.taskName}»`,
          color:
            tone === "alert"
              ? "#fb7185"
              : tone === "done"
                ? "#86efac"
                : deskById.get(event.targetId ?? "")?.color ?? "#f59e0b",
          kind: tone === "alert" ? "warn" : tone === "done" ? "done" : "work",
        });
      }
    } else {
      workEvents.forEach((event) => seenWorkEvents.current.add(event.eventId));
      for (const interaction of interactions) {
        fresh.push({
          id: ++eventSeq,
          time: now,
          text: `${nameOf(interaction.sourceId)} → ${nameOf(interaction.targetId)}: «${interaction.taskName ?? "Flujo activo"}»`,
          color: deskById.get(interaction.targetId)?.color ?? "#f59e0b",
          kind: "work",
        });
      }
      initialized.current = true;
    }

    for (const d of desks) {
      const before = prevMap.get(d.agent.id);
      if (before) {
        if (before.state !== d.state) {
          const e = stateEvent(d, d.state);
          if (e) fresh.push({ id: ++eventSeq, time: now, ...e });
        }
      }
      prevMap.set(d.agent.id, { state: d.state });
    }
    if (fresh.length) {
      setEvents((evs) => [...fresh.reverse(), ...evs].slice(0, 24));
    }
  }, [desks, interactions, coordinator, workEvents]);

  return events;
}
