import type { Agent } from "@/types";
import type { Specialist } from "@/types/specialists";
import { SpecialistCard } from "./SpecialistCard";
import { Shield, Layers } from "lucide-react";

interface SpecialistHivePanelProps {
  specialists: Specialist[];
  coordinator?: Agent;
  onToggle: (id: string, active: boolean) => Promise<void>;
}

export function SpecialistHivePanel({ specialists, coordinator, onToggle }: SpecialistHivePanelProps) {
  if (specialists.length === 0) return null;

  const awakeCount = specialists.filter((s) => s.runtime.state === "awake").length;

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Layers className="h-4 w-4 text-cyan-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white/90">La Colmena</h3>
          <p className="text-xs text-white/40">
            {specialists.length} especialistas · {awakeCount} despiertos ahora
          </p>
        </div>
      </div>

      {coordinator && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-purple-500/20 bg-purple-500/5 backdrop-blur-xl px-5 py-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500/10 border border-purple-500/20 shrink-0">
            <Shield className="h-5 w-5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white/90 truncate">{coordinator.name}</p>
            <p className="text-[10px] uppercase tracking-widest text-purple-300/70 font-semibold">
              Coordinador — enruta tareas a la colmena
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {specialists.map((specialist) => (
          <SpecialistCard key={specialist.id} specialist={specialist} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}
