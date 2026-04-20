import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Agent } from "@/types";
import { Shield, Cpu, Wrench, Zap, Edit2, Trash2 } from "lucide-react";
import { useAgents } from "@/stores/useGlobalConfigStore";
import { swal } from "@/lib/swal";

const sqrt3 = Math.sqrt(3);
const GRID_R = 92;

function axialToPixel(q: number, r: number) {
  return {
    x: GRID_R * 1.5 * q,
    y: GRID_R * (sqrt3 / 2 * q + sqrt3 * r),
  };
}

const RING1_AXIAL = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const RING2_AXIAL = [
  { q: 2, r: 0 }, { q: 2, r: -1 }, { q: 2, r: -2 },
  { q: 1, r: -2 }, { q: 0, r: -2 }, { q: -1, r: -1 },
  { q: -2, r: 0 }, { q: -2, r: 1 }, { q: -2, r: 2 },
  { q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 1 },
];

const HEX_CLIP = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

const STATUS_COLORS: Record<string, { bg: string; dot: string; glow: string }> = {
  active:    { bg: "#22c55e22", dot: "#22c55e", glow: "0 0 12px #22c55e88" },
  idle:      { bg: "#f59e0b22", dot: "#f59e0b", glow: "0 0 12px #f59e0b88" },
  thinking:  { bg: "#6366f122", dot: "#818cf8", glow: "0 0 12px #6366f188" },
  error:     { bg: "#ef444422", dot: "#ef4444", glow: "0 0 12px #ef444488" },
  hibernated:{ bg: "#1f293700", dot: "#4b5563", glow: "none" },
};

interface HoneycombGridProps {
  agents: Agent[];
  onEdit?: (agent: Agent) => void;
}

export function HoneycombGrid({ agents, onEdit }: HoneycombGridProps) {
  const navigate = useNavigate();
  const { deleteAgent } = useAgents();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { coordinator, workers } = useMemo(() => {
    const coord = agents.find(a => a.role === "coordinator") ?? agents[0];
    const wrks = agents.filter(a => a.id !== coord?.id);
    return { coordinator: coord, workers: wrks };
  }, [agents]);

  const allPositions = useMemo(() => [
    ...RING1_AXIAL.map(({ q, r }) => axialToPixel(q, r)),
    ...RING2_AXIAL.map(({ q, r }) => axialToPixel(q, r)),
  ], []);

  const visibleWorkers = workers.slice(0, allPositions.length);
  const maxRing = workers.length > 6 ? 2 : 1;

  const containerW = maxRing === 2 ? 740 : 540;
  const containerH = maxRing === 2 ? 800 : 540;
  const cx = containerW / 2;
  const cy = containerH / 2;

  // Hex visual sizes (flat-top: W = 2R, H = sqrt3 * R)
  const CX_W = 172; const CX_H = Math.round(172 * sqrt3 / 2);
  const WX_W = 130; const WX_H = Math.round(130 * sqrt3 / 2);

  const handleDelete = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await swal.fire({
      title: "¿Eliminar Agente?",
      text: `¿Eliminar "${agent.name}"?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      background: "#09090b",
      color: "#fff",
    });
    if (result.isConfirmed) {
      try { await deleteAgent(agent.id); } catch {}
    }
  };

  const coordStatus = coordinator
    ? STATUS_COLORS[coordinator.enabled ? coordinator.status : "hibernated"] ?? STATUS_COLORS.hibernated
    : STATUS_COLORS.hibernated;

  return (
    <div className="w-full overflow-x-auto overflow-y-visible pb-4">
      <div
        className="relative mx-auto select-none"
        style={{ width: containerW, height: containerH }}
      >
        {/* Ambient glow under coordinator */}
        <div
          className="absolute pointer-events-none rounded-full blur-[80px] opacity-30"
          style={{
            width: 260,
            height: 260,
            left: cx - 130,
            top: cy - 130,
            background: "radial-gradient(circle, rgba(245,158,11,0.6) 0%, transparent 70%)",
          }}
        />

        {/* SVG: honeycomb bg pattern + connection lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={containerW}
          height={containerH}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Subtle hex tile pattern */}
            <pattern id="hc-hex" x="0" y="0" width="52" height="30" patternUnits="userSpaceOnUse">
              <polygon
                points="26,1 51,15.5 51,29 26,29 1,15.5 1,1"
                fill="none"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
              />
            </pattern>
            {/* Radial fade mask for pattern */}
            <radialGradient id="fade-mask" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.08" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Bg hex tile */}
          <rect width={containerW} height={containerH} fill="url(#hc-hex)" />
          <rect width={containerW} height={containerH} fill="url(#fade-mask)" />

          {/* Connection lines: center → each worker */}
          {visibleWorkers.map((agent, i) => {
            const pos = allPositions[i];
            const isHovered = hoveredId === agent.id;
            return (
              <g key={`line-${agent.id}`}>
                <line
                  x1={cx} y1={cy}
                  x2={cx + pos.x} y2={cy + pos.y}
                  stroke={isHovered ? "rgba(245,158,11,0.5)" : "rgba(245,158,11,0.12)"}
                  strokeWidth={isHovered ? 2 : 1}
                  strokeDasharray="5 5"
                  style={{ transition: "all 0.3s ease" }}
                />
                {/* Traveling pulse dot */}
                {agent.enabled && (
                  <circle r="3" fill="rgba(245,158,11,0.7)">
                    <animateMotion
                      dur={`${2.5 + i * 0.4}s`}
                      repeatCount="indefinite"
                      path={`M ${cx} ${cy} L ${cx + pos.x} ${cy + pos.y}`}
                    />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* ── COORDINATOR (center) ── */}
        {coordinator && (
          <div
            className="absolute cursor-pointer group z-20"
            style={{ left: cx - CX_W / 2, top: cy - CX_H / 2, width: CX_W, height: CX_H }}
            onMouseEnter={() => setHoveredId(coordinator.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Outer glow ring */}
            <div
              className="absolute inset-[-6px] opacity-40 group-hover:opacity-80 transition-opacity duration-500 blur-[10px]"
              style={{
                clipPath: HEX_CLIP,
                background: "rgba(245,158,11,0.5)",
              }}
            />
            {/* Border shell */}
            <div
              className="absolute inset-0 transition-transform duration-300 group-hover:scale-105"
              style={{ clipPath: HEX_CLIP, background: "rgba(245,158,11,0.55)" }}
            >
              {/* Inner fill */}
              <div
                className="absolute inset-[2px]"
                style={{
                  clipPath: HEX_CLIP,
                  background: "linear-gradient(145deg, #1c1100 0%, #0d0b00 60%, #120d00 100%)",
                }}
              >
                {/* Content */}
                <div className="flex flex-col items-center justify-center h-full gap-1.5 px-3">
                  <div className="relative">
                    <Shield className="h-8 w-8 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                    <div
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-black"
                      style={{
                        backgroundColor: coordStatus.dot,
                        boxShadow: coordStatus.glow,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-black text-amber-300 tracking-[0.12em] text-center leading-tight uppercase line-clamp-2">
                    {coordinator.name}
                  </span>
                  <span className="text-[8px] text-amber-500/70 tracking-widest uppercase font-semibold">
                    Coordinadora
                  </span>
                </div>
              </div>
            </div>

            {/* Context actions on hover */}
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 hidden group-hover:flex gap-1 z-30 animate-in fade-in duration-200">
              <button
                className="p-1.5 rounded bg-black/80 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); onEdit?.(coordinator); }}
                title="Editar"
              >
                <Edit2 className="h-3 w-3" />
              </button>
              <button
                className="p-1.5 rounded bg-black/80 border border-white/10 text-white/50 hover:text-white hover:border-white/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); navigate(`/agents/${coordinator.id}`); }}
                title="Ver detalle"
              >
                <span className="text-[9px] px-0.5">→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── WORKER HEXES ── */}
        {visibleWorkers.map((agent, i) => {
          const pos = allPositions[i];
          const left = cx + pos.x - WX_W / 2;
          const top = cy + pos.y - WX_H / 2;
          const displayStatus = agent.enabled ? agent.status : "hibernated";
          const sc = STATUS_COLORS[displayStatus] ?? STATUS_COLORS.hibernated;
          const tools = agent.toolsJson ? (JSON.parse(agent.toolsJson) as unknown[]).length : 0;
          const skills = agent.skillsJson ? (JSON.parse(agent.skillsJson) as unknown[]).length : 0;
          const isHov = hoveredId === agent.id;

          const borderColor = agent.enabled
            ? isHov ? "rgba(96,165,250,0.9)" : "rgba(59,130,246,0.45)"
            : "rgba(255,255,255,0.08)";

          const innerBg = agent.enabled
            ? "linear-gradient(145deg, #050d1c 0%, #020912 60%, #040a18 100%)"
            : "#0a0a0b";

          return (
            <div
              key={agent.id}
              className="absolute cursor-pointer group z-10"
              style={{ left, top, width: WX_W, height: WX_H }}
              onMouseEnter={() => setHoveredId(agent.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Outer glow */}
              {agent.enabled && (
                <div
                  className="absolute inset-[-5px] transition-opacity duration-300 blur-[8px]"
                  style={{
                    clipPath: HEX_CLIP,
                    background: "rgba(59,130,246,0.35)",
                    opacity: isHov ? 0.8 : 0.2,
                  }}
                />
              )}

              {/* Border shell */}
              <div
                className="absolute inset-0 transition-transform duration-300"
                style={{
                  clipPath: HEX_CLIP,
                  background: borderColor,
                  transform: isHov ? "scale(1.08)" : "scale(1)",
                }}
              >
                {/* Inner fill */}
                <div
                  className="absolute inset-[1.5px]"
                  style={{ clipPath: HEX_CLIP, background: innerBg }}
                >
                  <div className="flex flex-col items-center justify-center h-full gap-1 px-2">
                    <div className="relative">
                      <Cpu
                        className="h-5 w-5 transition-colors duration-300"
                        style={{ color: agent.enabled ? "#60a5fa" : "#374151" }}
                      />
                      <div
                        className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#020912]"
                        style={{ backgroundColor: sc.dot, boxShadow: sc.glow }}
                      />
                    </div>
                    <span
                      className="text-[8px] font-bold tracking-wide text-center leading-tight uppercase line-clamp-2 transition-colors duration-300"
                      style={{ color: agent.enabled ? "#93c5fd" : "#374151" }}
                    >
                      {agent.name}
                    </span>
                    {(tools > 0 || skills > 0) && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {tools > 0 && (
                          <span className="flex items-center gap-0.5 text-[7px] text-emerald-400/70">
                            <Wrench className="h-2 w-2" />{tools}
                          </span>
                        )}
                        {skills > 0 && (
                          <span className="flex items-center gap-0.5 text-[7px] text-amber-400/70">
                            <Zap className="h-2 w-2" />{skills}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Context actions on hover */}
              <div
                className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-30 transition-all duration-200"
                style={{ opacity: isHov ? 1 : 0, pointerEvents: isHov ? "auto" : "none" }}
              >
                <div className="flex gap-1">
                  <button
                    className="p-1 rounded bg-black/80 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onEdit?.(agent); }}
                    title="Editar"
                  >
                    <Edit2 className="h-2.5 w-2.5" />
                  </button>
                  <button
                    className="p-1 rounded bg-black/80 border border-white/10 text-white/50 hover:text-white transition-colors"
                    onClick={(e) => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}
                    title="Ver"
                  >
                    <span className="text-[8px]">→</span>
                  </button>
                  <button
                    className="p-1 rounded bg-black/80 border border-red-500/20 text-red-400/60 hover:text-red-400 transition-colors"
                    onClick={(e) => handleDelete(agent, e)}
                    title="Eliminar"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Overflow badge */}
        {workers.length > allPositions.length && (
          <div className="absolute bottom-6 right-6 text-[11px] text-white/50 bg-white/5 rounded-full px-3 py-1 border border-white/10 backdrop-blur-sm">
            +{workers.length - allPositions.length} agentes en lista
          </div>
        )}
      </div>

      {/* Extra agents that don't fit in rings (listed below) */}
      {workers.length > allPositions.length && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-w-[740px] mx-auto px-4">
          {workers.slice(allPositions.length).map(agent => (
            <button
              key={agent.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all text-left group"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <Cpu className="h-4 w-4 text-blue-400/60 shrink-0" />
              <span className="text-xs text-white/60 group-hover:text-white/90 truncate transition-colors">
                {agent.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
