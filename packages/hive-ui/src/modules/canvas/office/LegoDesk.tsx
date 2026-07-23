import { LegoMinifig } from "./LegoMinifig";
import { ActivityBubble } from "./ActivityBubble";
import { useFinishFlash } from "./useFinishFlash";
import type { DeskModel } from "./useOfficeModel";

const STATE_DOT: Record<string, string> = {
  disabled: "bg-white/15",
  dormant: "bg-white/30",
  idle: "bg-emerald-400",
  thinking: "bg-indigo-400",
  tool_call: "bg-cyan-400",
  stuck: "bg-red-400",
};

interface LegoDeskProps {
  desk: DeskModel;
}

export function LegoDesk({ desk }: LegoDeskProps) {
  const { specialist, state, currentTool, workerCount, position, color } = desk;
  const justFinished = useFinishFlash(state);
  const isMonitorOn = state === "tool_call" || state === "thinking" || justFinished;
  const isError = state === "stuck";

  return (
    <div
      className="lego-desk"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      title={specialist.description}
    >
      <ActivityBubble state={state} currentTool={currentTool} workerCount={workerCount} justFinished={justFinished} />

      {/* Desk surface + monitor */}
      <div className="lego-desk__surface">
        <div
          className="lego-desk__monitor"
          style={{
            background: isError ? "#7f1d1d" : isMonitorOn ? `${color}33` : "#1f2937",
            boxShadow: isMonitorOn ? `0 0 10px ${color}88` : isError ? "0 0 10px #ef444488" : "none",
            borderColor: isMonitorOn ? color : isError ? "#ef4444" : "#374151",
          }}
        />
        <LegoMinifig color={color} state={state} size={56} />
      </div>

      <div className="lego-desk__placard">
        <span className={`lego-desk__dot ${STATE_DOT[state]}`} />
        <span className="lego-desk__name">{specialist.name}</span>
      </div>
    </div>
  );
}
