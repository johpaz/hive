import type { DeskState } from "./useOfficeModel";

interface LegoMinifigProps {
  color: string;
  state: DeskState;
  size?: number;
}

export function LegoMinifig({ color, state, size = 64 }: LegoMinifigProps) {
  const isDormantLike = state === "dormant" || state === "disabled";
  const rootClass = [
    "lego-minifig",
    state === "idle" && "lego-idle",
    state === "thinking" && "lego-thinking",
    state === "tool_call" && "lego-toolcall",
    state === "stuck" && "lego-stuck",
    state === "dormant" && "lego-dormant",
    state === "disabled" && "lego-disabled",
  ].filter(Boolean).join(" ");

  return (
    <svg
      className={rootClass}
      width={size}
      height={size}
      viewBox="0 0 60 76"
      style={{ filter: isDormantLike ? "grayscale(1)" : undefined, opacity: state === "disabled" ? 0.35 : 1 }}
    >
      {/* legs — seated */}
      <rect x="14" y="58" width="13" height="16" rx="3" fill="#1f2937" />
      <rect x="33" y="58" width="13" height="16" rx="3" fill="#1f2937" />

      {/* torso */}
      <g className="lego-torso-group">
        <rect x="12" y="34" width="36" height="28" rx="6" fill={color} />
        <rect x="12" y="34" width="36" height="6" rx="3" fill="#ffffff22" />
      </g>

      {/* arms */}
      <g className="lego-arm-left" style={{ transformOrigin: "17px 38px" }}>
        <rect x="5" y="36" width="10" height="22" rx="4" fill={color} />
        <circle cx="10" cy="58" r="5" fill="#f4c542" />
      </g>
      <g className="lego-arm-right" style={{ transformOrigin: "43px 38px" }}>
        <rect x="45" y="36" width="10" height="22" rx="4" fill={color} />
        <circle cx="50" cy="58" r="5" fill="#f4c542" />
      </g>

      {/* head */}
      <g className="lego-head-group" style={{ transformOrigin: "30px 30px" }}>
        <rect x="24" y="8" width="6" height="8" fill="#f4c542" />
        <circle cx="30" cy="24" r="15" fill="#f4c542" />
        <circle cx="24" cy="24" r="1.6" fill="#1f2937" />
        <circle cx="36" cy="24" r="1.6" fill="#1f2937" />
        <path d="M24 30 Q30 34 36 30" stroke="#1f2937" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
