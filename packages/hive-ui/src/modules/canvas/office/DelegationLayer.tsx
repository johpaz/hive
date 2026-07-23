import type { DeskModel, DeskState } from "./useOfficeModel";

interface DelegationLayerProps {
  coordinatorPos: { x: number; y: number };
  desks: DeskModel[];
}

const PULSE_STATES = new Set<DeskState>(["thinking", "tool_call"]);

function lineStyle(state: DeskState): { opacity: number; width: number; grayscale: boolean } {
  switch (state) {
    case "disabled": return { opacity: 0.06, width: 0.25, grayscale: true };
    case "dormant": return { opacity: 0.16, width: 0.3, grayscale: false };
    case "idle": return { opacity: 0.3, width: 0.3, grayscale: false };
    case "stuck": return { opacity: 0.55, width: 0.4, grayscale: false };
    case "thinking":
    case "tool_call": return { opacity: 0.6, width: 0.45, grayscale: false };
  }
}

// Every desk is wired to the coordinator — this line is the org-chart edge
// (worker.parent_id === coordinator.id in the data model), always drawn.
// Brightness/pulse only signal current activity, not the connection itself.
export function DelegationLayer({ coordinatorPos, desks }: DelegationLayerProps) {
  return (
    <svg
      className="lego-delegation-layer"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {desks.map((desk) => {
        const d = `M ${coordinatorPos.x} ${coordinatorPos.y} Q ${(coordinatorPos.x + desk.position.x) / 2} ${(coordinatorPos.y + desk.position.y) / 2 - 6} ${desk.position.x} ${desk.position.y}`;
        const { opacity, width, grayscale } = lineStyle(desk.state);
        const stroke = grayscale ? "#6b7280" : desk.color;
        return (
          <g key={desk.specialist.id}>
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeOpacity={opacity}
              strokeWidth={width}
              strokeDasharray="1.5 1.5"
              vectorEffect="non-scaling-stroke"
            />
            {PULSE_STATES.has(desk.state) && (
              <circle r="0.9" fill={desk.color}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}
