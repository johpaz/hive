import { useEffect, useRef, useState } from "react";
import type { DeskModel, DeskState } from "@/modules/office3d/state/useOfficeModel";
import { humanizeTool } from "@/modules/office3d/state/toolLabels";

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
  task: string | null;
}

function stateEvent(desk: DeskModel, next: DeskState): Omit<TickerEvent, "id" | "time"> | null {
  if (next === "tool_call" && !desk.currentTask)
    return { text: `${desk.agent.name} · ${humanizeTool(desk.currentTool) ?? "Ejecutando herramienta"}`, color: desk.color, kind: "work" };
  if (next === "thinking" && !desk.currentTask) return { text: `${desk.agent.name} está pensando…`, color: desk.color, kind: "info" };
  if (next === "stuck") return { text: `${desk.agent.name} necesita ayuda`, color: "#f87171", kind: "warn" };
  if (next === "idle" && !desk.currentTask) return { text: `${desk.agent.name} completó su tarea`, color: desk.color, kind: "done" };
  return null;
}

/**
 * Cinta de eventos derivada de los escritorios: delegaciones (quién delega
 * QUÉ a quién), herramientas en curso, atascos y finalizaciones.
 */
export function useEventFeed(desks: DeskModel[], coordinatorName = "Coordinador"): TickerEvent[] {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const prev = useRef<Map<string, PrevDeskInfo>>(new Map());

  useEffect(() => {
    const prevMap = prev.current;
    const fresh: TickerEvent[] = [];
    const now = new Date().toLocaleTimeString("es", { hour12: false });
    for (const d of desks) {
      const before = prevMap.get(d.agent.id);
      const beforeTask = before?.task ?? null;
      const nowTask = d.currentTask;

      if (before) {
        // Delegación nueva (o relevo de tarea): quién delega QUÉ a quién.
        // El delegante puede ser el coordinador u otro agente (p. ej. el
        // eslabón worker → verificador del loop).
        if (nowTask && beforeTask !== nowTask) {
          const delegatorName = d.delegatedBy
            ? (desks.find((x) => x.agent.id === d.delegatedBy)?.agent.name ?? coordinatorName)
            : coordinatorName;
          fresh.push({
            id: ++eventSeq,
            time: now,
            text: `${delegatorName} → ${d.agent.name}: «${nowTask}»`,
            color: d.color,
            kind: "work",
          });
        } else if (!nowTask && beforeTask) {          fresh.push({
            id: ++eventSeq,
            time: now,
            text: `${d.agent.name} completó «${beforeTask}»`,
            color: d.color,
            kind: "done",
          });
        } else if (before.state !== d.state) {
          const e = stateEvent(d, d.state);
          if (e) fresh.push({ id: ++eventSeq, time: now, ...e });
        }
      } else if (nowTask) {
        // Primer avistamiento (montaje o reconexión): si el agente ya está
        // trabajando, sembrar el evento para que la cinta no amanezca vacía.
        const delegatorName = d.delegatedBy
          ? (desks.find((x) => x.agent.id === d.delegatedBy)?.agent.name ?? coordinatorName)
          : coordinatorName;
        fresh.push({
          id: ++eventSeq,
          time: now,
          text: `${delegatorName} → ${d.agent.name}: «${nowTask}»`,
          color: d.color,
          kind: "work",
        });
      }
      prevMap.set(d.agent.id, { state: d.state, task: nowTask });
    }
    if (fresh.length) {
      setEvents((evs) => [...fresh.reverse(), ...evs].slice(0, 24));
    }
  }, [desks, coordinatorName]);

  return events;
}
