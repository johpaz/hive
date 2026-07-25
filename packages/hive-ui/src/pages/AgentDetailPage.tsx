import { useParams, useNavigate } from "react-router-dom";
import { AgentDetailsEditor } from "@/modules/agent-config/details/AgentDetailsEditor";
import { AgentInternalCard } from "@/modules/agents/AgentInternalCard";
import { AgentToolsPanel } from "@/modules/agents/AgentToolsPanel";
import { useAgents } from "@/stores/useGlobalConfigStore";
import { ChevronLeft, LayoutGrid, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const agentId = id ?? "unknown";
  const { agents, fetchAgents } = useAgents();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const agent = agents.find(a => a.id === agentId);

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">

        {/* Navigation Header */}
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/agents")}
            className="group flex items-center gap-2 text-white/40 hover:text-white hover:bg-white/5 px-4 py-2 rounded-xl transition-colors"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            <span className="text-sm font-bold uppercase tracking-widest">Volver a la Colmena</span>
          </Button>

          <div className="flex items-center gap-4 text-white/20">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Agentes</span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Detalles Operativos</span>
            </div>
          </div>
        </div>

        {/* Hero Card */}
        {agent ? (
          <>
            <AgentInternalCard agent={agent} />
            <AgentToolsPanel agent={agent} />
            <div className="grid grid-cols-1 gap-8">
              <AgentDetailsEditor agentId={agentId} />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
            <div className="relative">
              <div className="h-24 w-24 rounded-full border-4 border-t-blue-500 border-white/5 animate-spin" />
              <Activity className="absolute inset-0 m-auto h-8 w-8 text-blue-400 animate-pulse" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Sincronizando con el Nodo</h3>
              <p className="text-white/40 max-w-xs mx-auto">
                Estamos recuperando la configuración cuántica de este agente desde la base de datos central.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
