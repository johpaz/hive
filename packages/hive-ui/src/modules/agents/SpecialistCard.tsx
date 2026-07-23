import { useState } from "react";
import type { Specialist } from "@/types/specialists";
import { Switch } from "@/components/ui/switch";
import { Wrench, Zap, ThumbsUp, ThumbsDown, CheckCircle2, Moon, Sparkles } from "lucide-react";
import { swal } from "@/lib/swal";

interface SpecialistCardProps {
  specialist: Specialist;
  onToggle: (id: string, active: boolean) => Promise<void>;
}

const STATE_STYLE: Record<string, { dot: string; label: string; glow: string }> = {
  dormant: { dot: "bg-white/20", label: "Dormido", glow: "none" },
  idle: { dot: "bg-emerald-400", label: "Despierto", glow: "0 0 8px rgba(52,211,153,0.7)" },
  thinking: { dot: "bg-indigo-400 animate-pulse", label: "Pensando", glow: "0 0 8px rgba(129,140,248,0.7)" },
  tool_call: { dot: "bg-cyan-400 animate-pulse", label: "Trabajando", glow: "0 0 8px rgba(34,211,238,0.7)" },
};

function workerStateLabel(specialist: Specialist): { key: string; currentTool: string | null } {
  if (specialist.runtime.state === "dormant") return { key: "dormant", currentTool: null };
  const priority = ["tool_call", "thinking", "idle"];
  const best = specialist.runtime.workers
    .slice()
    .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];
  return { key: priority.includes(best?.status) ? best.status : "idle", currentTool: best?.currentTool ?? null };
}

export function SpecialistCard({ specialist, onToggle }: SpecialistCardProps) {
  const [busy, setBusy] = useState(false);
  const { key, currentTool } = workerStateLabel(specialist);
  const state = STATE_STYLE[key] ?? STATE_STYLE.dormant;
  const workerCount = specialist.runtime.workers.length;

  const handleToggle = async (next: boolean) => {
    if (!next) {
      const result = await swal.fire({
        title: "¿Desactivar especialista?",
        text: `El coordinador dejará de delegar tareas a "${specialist.name}".`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Sí, desactivar",
        cancelButtonText: "Cancelar",
        background: "#09090b",
        color: "#fff",
      });
      if (!result.isConfirmed) return;
    }
    setBusy(true);
    try {
      await onToggle(specialist.id, next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-black/40 backdrop-blur-xl transition-all duration-500 flex flex-col h-full
        ${specialist.active
          ? "border-white/10 hover:border-cyan-500/50 hover:bg-white/[0.03] hover:shadow-[0_0_30px_rgba(34,211,238,0.12)]"
          : "border-white/5 opacity-60 grayscale hover:grayscale-0"}`}
    >
      <div className="p-4 flex flex-col flex-1 relative z-10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20">
                <Sparkles className="h-4 w-4 text-cyan-400" />
              </div>
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-black ${state.dot}`}
                style={{ boxShadow: state.glow }}
              />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white/95 truncate">{specialist.name}</h4>
              <span className="text-[9px] uppercase tracking-widest text-white/40 font-semibold">
                {state.label}{workerCount > 1 ? ` ×${workerCount}` : ""}
              </span>
            </div>
          </div>
          <Switch checked={specialist.active} disabled={busy} onCheckedChange={handleToggle} />
        </div>

        <p className="text-xs text-white/50 line-clamp-2 leading-relaxed font-light mb-3">
          {specialist.description}
        </p>

        {currentTool && (
          <div className="mb-3 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-mono text-cyan-300 truncate">
            {currentTool}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-white/5 border border-white/10 text-white/60">
            <Wrench className="h-2.5 w-2.5 text-emerald-400/70" />
            {specialist.tools.length}
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-white/5 border border-white/10 text-white/60">
            <Zap className="h-2.5 w-2.5 text-amber-400/70" />
            {specialist.skills.length}
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-white/5 border border-white/10 text-emerald-400/80">
            <ThumbsUp className="h-2.5 w-2.5" />
            {specialist.ace.helpful}
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-white/5 border border-white/10 text-red-400/80">
            <ThumbsDown className="h-2.5 w-2.5" />
            {specialist.ace.harmful}
          </span>
        </div>

        <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between text-[10px]">
          {specialist.lastVerification ? (
            <span className={`flex items-center gap-1 font-semibold uppercase tracking-wider
              ${specialist.lastVerification.status === "verified" ? "text-emerald-400" : "text-amber-400"}`}>
              <CheckCircle2 className="h-3 w-3" />
              {specialist.lastVerification.status === "verified" ? "Verificado" : specialist.lastVerification.status}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-white/25 font-medium uppercase tracking-wider">
              <Moon className="h-3 w-3" />
              Sin veredictos
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
