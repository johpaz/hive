import { AgentCard } from "./AgentCard";
import type { Agent } from "@/types";

interface AgentListProps {
  agents: Agent[];
  onEdit?: (agent: Agent) => void;
}

export function AgentList({ agents, onEdit }: AgentListProps) {
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
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-20">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} onEdit={onEdit} />
      ))}
    </div>
  );
}
