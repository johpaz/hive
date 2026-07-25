import { AgentCard } from "./AgentCard";
import { HoneycombGrid } from "./HoneycombGrid";
import type { Agent } from "@/types";

interface AgentListProps {
  agents: Agent[];
  onEdit?: (agent: Agent) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function AgentList({ agents, onEdit, selectedId, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="hive-empty-state">
        <div className="p-4 rounded-full bg-white/5 mb-4">
          <div className="h-10 w-10 border-2 border-dashed border-white/20 rounded-full" />
        </div>
        <p className="hive-label uppercase">No se detectaron nodos activos</p>
        <p className="text-xs text-white/20 mt-1">Comienza desplegando un nuevo agente en tu red.</p>
      </div>
    );
  }

  return (
    <>
      {/* Honeycomb view — desktop */}
      <div className="hidden md:block">
        <HoneycombGrid
          agents={agents}
          onEdit={onEdit}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>

      {/* Card grid — mobile */}
      <div className="grid gap-6 sm:grid-cols-2 pb-20 md:hidden">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onEdit={onEdit} />
        ))}
      </div>
    </>
  );
}
