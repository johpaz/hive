import { useState } from "react";
import { ChevronDown } from "lucide-react";

const PIPELINE_PHASES = [
  {
    label: "Análisis",
    agents: ["👤", "🎯", "🗺️"],
    color: "text-blue-400",
    pillBg: "bg-blue-500/10",
    pillBorder: "border-blue-500/20",
  },
  {
    label: "Contenido",
    agents: ["📖", "✏️", "❓", "⚡", "💻", "📊", "🎞️", "🖼️"],
    color: "text-blue-400",
    pillBg: "bg-blue-500/10",
    pillBorder: "border-blue-500/20",
  },
  {
    label: "Final",
    agents: ["📈", "🏆", "📝", "🔍", "🧠"],
    color: "text-emerald-400",
    pillBg: "bg-emerald-500/10",
    pillBorder: "border-emerald-500/20",
  },
];

interface SwarmPipelinePreviewProps {
  agentCount: number;
}

export function SwarmPipelinePreview({ agentCount }: SwarmPipelinePreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        borderColor: "hsl(0 0% 100% / 0.06)",
        background: "hsl(220 15% 11% / 0.8)",
        backdropFilter: "blur(20px)",
      }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">🐝</span>
          <span className="text-sm font-semibold" style={{ color: "hsl(var(--hive-muted-foreground))" }}>
            Ver cómo trabajan los {agentCount} agentes
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          style={{ color: "hsl(0 0% 100% / 0.3)" }}
        />
      </button>

      {open && (
        <div className="px-6 pb-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="h-px bg-gradient-to-r from-transparent via-white/8 to-transparent mb-5" />
          <div className="flex items-start gap-3 overflow-x-auto pb-2">
            {PIPELINE_PHASES.map((phase, i) => (
              <div key={phase.label} className="flex items-center gap-3 flex-shrink-0">
                <div className="space-y-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] border ${phase.pillBg} ${phase.pillBorder} ${phase.color}`}
                  >
                    {phase.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                    {phase.agents.map(emoji => (
                      <span
                        key={emoji}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-base hover:bg-white/[0.08] hover:border-white/10 transition-all cursor-default border"
                        style={{
                          background: "hsl(0 0% 100% / 0.04)",
                          borderColor: "hsl(0 0% 100% / 0.06)",
                        }}
                      >
                        {emoji}
                      </span>
                    ))}
                  </div>
                </div>
                {i < PIPELINE_PHASES.length - 1 && (
                  <div className="flex flex-col items-center gap-1 self-center mt-4">
                    <div
                      className="w-8 h-px border-t-2 border-dashed"
                      style={{ borderTopColor: "hsl(var(--hive-blue) / 0.2)" }}
                    />
                    <span className="text-xs" style={{ color: "hsl(var(--hive-blue) / 0.25)" }}>→</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
