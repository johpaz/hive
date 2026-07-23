import type { DeskState } from "./useOfficeModel";
import { humanizeTool } from "./toolLabels";

interface ActivityBubbleProps {
  state: DeskState;
  currentTool: string | null;
  workerCount: number;
  /** True for a couple seconds right after leaving an active state — see useFinishFlash. */
  justFinished?: boolean;
}

export function ActivityBubble({ state, currentTool, workerCount, justFinished }: ActivityBubbleProps) {
  if (state === "disabled") return null;

  if (state === "dormant") {
    return (
      <div className="lego-bubble lego-bubble--zzz">
        <span>Zzz</span>
      </div>
    );
  }

  if (state === "thinking") {
    return (
      <div className="lego-activity-bubble lego-activity-bubble--thinking">
        <span>Pensando</span>
        <span className="lego-dot-row">
          <span className="lego-dot" />
          <span className="lego-dot" />
          <span className="lego-dot" />
        </span>
      </div>
    );
  }

  if (state === "tool_call") {
    const label = humanizeTool(currentTool) ?? "Trabajando";
    return (
      <div className="lego-activity-bubble lego-activity-bubble--tool" title={currentTool ?? undefined}>
        <span className="lego-activity-bubble__dot" />
        <span className="lego-activity-bubble__label">
          {label}
          {workerCount > 1 ? ` ×${workerCount}` : ""}
        </span>
      </div>
    );
  }

  if (state === "stuck") {
    return (
      <div className="lego-activity-bubble lego-activity-bubble--stuck">
        <span>⚠ Necesita ayuda</span>
      </div>
    );
  }

  // idle
  if (justFinished) {
    return (
      <div className="lego-activity-bubble lego-activity-bubble--done">
        <span>✓ Listo</span>
      </div>
    );
  }

  return null;
}
