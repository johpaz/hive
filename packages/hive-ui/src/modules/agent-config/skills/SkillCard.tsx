import { Zap, Cpu, Code2, Globe, Search, MessageSquare, BarChart3, Languages, Sparkles } from "lucide-react";
import type { Skill } from "@/types";

interface SkillCardProps {
  skill: Skill;
  onClick?: () => void;
  className?: string;
}

const getSkillIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("code") || n.includes("program")) return <Code2 className="h-4 w-4" />;
  if (n.includes("research") || n.includes("investiga")) return <Search className="h-4 w-4" />;
  if (n.includes("write") || n.includes("escrib")) return <MessageSquare className="h-4 w-4" />;
  if (n.includes("data") || n.includes("anal") || n.includes("estad")) return <BarChart3 className="h-4 w-4" />;
  if (n.includes("trans") || n.includes("traduc")) return <Languages className="h-4 w-4" />;
  if (n.includes("web") || n.includes("glob")) return <Globe className="h-4 w-4" />;
  return <Zap className="h-4 w-4" />;
};

export function SkillCard({ skill, onClick, className }: SkillCardProps) {
  const active = !!skill.active;

  return (
    <div
      onClick={onClick}
      className={`hive-card group transition-all duration-500 cursor-pointer ${active
        ? 'hive-card--active border-blue-500/20'
        : 'opacity-60 grayscale-[0.8] hover:opacity-100 hover:grayscale-0'
        } ${className}`}
    >
      <div className="hive-card-body">
        <div className="flex items-start justify-between mb-6">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-500 ${active
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-blue-glow'
            : 'bg-white/5 border-white/10 text-white/30'
            }`}>
            {getSkillIcon(skill.name)}
          </div>

          <div className="h-6 w-6 rounded-full border border-white/5 bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Sparkles className="h-3 w-3 text-blue-400" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-1 line-clamp-1 group-hover:text-blue-400 transition-colors">
              {skill.name}
            </h3>
            <p className="text-xs text-white/40 font-medium leading-relaxed line-clamp-2 h-8">
              {skill.body?.substring(0, 100) || skill.category}
            </p>
          </div>

          <div className="pt-4 border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="hive-stat">
                <span className="hive-stat__label">CATEGORY</span>
                <span className="hive-stat__value truncate max-w-[80px]">{skill.category || "GENERAL"}</span>
              </div>
              <div className="hive-stat">
                <span className="hive-stat__label">TOOLS</span>
                <span className="hive-stat__value">{skill.tools ? skill.tools.split(',').length : 0}</span>
              </div>
            </div>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-[9px] font-black text-blue-400 uppercase tracking-widest">
              DETALLES
              <Cpu className="h-3 w-3" />
            </div>
          </div>
        </div>
      </div>
      <div className={`hive-strip--bottom ${active ? 'bg-blue-500' : 'bg-white/10'}`} />
    </div>
  );
}
