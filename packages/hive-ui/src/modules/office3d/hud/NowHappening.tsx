import { AlertTriangle, CheckCircle2, Radio, SearchCheck, Send } from "lucide-react";
import type { GraphNode } from "@/stores/canvasStore";
import type { DeskModel } from "../state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";
import { workPhaseLabel, workPhaseTone } from "../state/presentation";

export function NowHappening({
  coordinator,
  desks,
}: {
  coordinator: GraphNode | null;
  desks: DeskModel[];
}) {
  const cue = useOffice3DStore((state) => state.activeCue);
  if (!cue) return null;

  const deskById = new Map(desks.map((desk) => [desk.agent.id, desk]));
  const nameOf = (id: string | null) =>
    !id
      ? coordinator?.name ?? "Coordinador"
      : id === coordinator?.id
        ? coordinator.name
        : deskById.get(id)?.agent.name ?? "Agente";
  const tone = workPhaseTone(cue.phase);
  const Icon =
    tone === "alert"
      ? AlertTriangle
      : tone === "done"
        ? CheckCircle2
        : tone === "review"
          ? SearchCheck
          : cue.phase === "delegated"
            ? Send
            : Radio;

  return (
    <section
      className={`office3d-now office3d-glass is-${tone}`}
      aria-live={tone === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="office3d-now-icon"><Icon size={17} /></div>
      <div className="office3d-now-copy">
        <span>AHORA OCURRE</span>
        <strong>{workPhaseLabel(cue.phase)}</strong>
        <p>
          {nameOf(cue.actorId)}
          <b>→</b>
          {nameOf(cue.targetId)}
        </p>
        <small>{cue.taskName}</small>
        {cue.detail && <em>{cue.detail}</em>}
      </div>
    </section>
  );
}
