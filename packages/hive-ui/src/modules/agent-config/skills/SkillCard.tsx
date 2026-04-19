import { Zap, Cpu, Code2, Globe, Search, MessageSquare, BarChart3, Languages, Wrench, Sparkles } from "lucide-react";
import type { Skill } from "@/types";

interface SkillCardProps {
  skill: Skill;
  onClick?: () => void;
  className?: string;
}

const getSkillIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("code") || n.includes("program")) return <Code2 className="h-5 w-5" />;
  if (n.includes("research") || n.includes("investiga")) return <Search className="h-5 w-5" />;
  if (n.includes("write") || n.includes("escrib")) return <MessageSquare className="h-5 w-5" />;
  if (n.includes("data") || n.includes("anal") || n.includes("estad")) return <BarChart3 className="h-5 w-5" />;
  if (n.includes("trans") || n.includes("traduc")) return <Languages className="h-5 w-5" />;
  if (n.includes("web") || n.includes("glob") || n.includes("scrape")) return <Globe className="h-5 w-5" />;
  if (n.includes("tool") || n.includes("herram")) return <Wrench className="h-5 w-5" />;
  if (n.includes("cpu") || n.includes("proc")) return <Cpu className="h-5 w-5" />;
  return <Zap className="h-5 w-5" />;
};

const toolsCount = (tools: string) => tools ? tools.split(',').filter(Boolean).length : 0;
const triggersCount = (triggers: string) => triggers ? triggers.split(',').filter(Boolean).length : 0;

export function SkillCard({ skill, onClick, className }: SkillCardProps) {
  const active = !!skill.active;
  const tCount = toolsCount(skill.tools);
  const trCount = triggersCount(skill.triggers);

  return (
    <div
      onClick={onClick}
      className={`hive-card group cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
        active ? 'hive-card--active' : 'hive-card--disabled'
      } ${className}`}
    >
      <div className="hive-card-body flex flex-col gap-4">

        {/* Top row: category + active pulse dot */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-white/30 bg-white/5 border border-white/5 rounded-full px-2.5 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-blue-400' : 'bg-white/20'}`} />
            {skill.category || "GENERAL"}
          </span>
          {active && (
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute h-2 w-2 rounded-full bg-blue-400 opacity-40" />
              <span className="relative h-2 w-2 rounded-full bg-blue-500" />
            </span>
          )}
        </div>

        {/* Icon + name */}
        <div className="flex items-start gap-4">
          <div className={`shrink-0 h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-300 ${
            active
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_12px_hsl(217_91%_60%/0.2)]'
              : 'bg-white/5 border-white/10 text-white/25'
          }`}>
            {getSkillIcon(skill.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`text-sm font-black uppercase tracking-tight line-clamp-1 transition-colors ${
              active ? 'text-white group-hover:text-blue-400' : 'text-white/40'
            }`}>
              {skill.name}
            </h3>
            <p className="text-[11px] text-white/30 leading-relaxed line-clamp-2 mt-1">
              {skill.body?.substring(0, 90) || "Sin descripción"}
            </p>
          </div>
        </div>

        {/* Footer badges */}
        <div className="pt-3 border-t border-white/5 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[9px] font-black tracking-widest uppercase text-amber-400/70 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-0.5">
            v{skill.version ?? 1}
          </span>
          {tCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black tracking-widest uppercase text-cyan-400/70 bg-cyan-500/5 border border-cyan-500/10 rounded px-2 py-0.5">
              {tCount} TOOLS
            </span>
          )}
          {trCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black tracking-widest uppercase text-purple-400/70 bg-purple-500/5 border border-purple-500/10 rounded px-2 py-0.5">
              {trCount} TRIGGERS
            </span>
          )}
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <Sparkles className="h-3 w-3 text-blue-400" />
          </div>
        </div>
      </div>

      <div className={`hive-strip--bottom ${active ? 'bg-blue-500' : 'bg-white/5'}`} />
    </div>
  );
}
