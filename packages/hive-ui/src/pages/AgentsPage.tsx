import { useEffect, useMemo, useState } from "react";
import { AgentList } from "@/modules/agents/AgentList";
import { AgentCreateForm } from "@/modules/agents/AgentCreateForm";
import { SpecialistHivePanel } from "@/modules/agents/SpecialistHivePanel";
import { Plus, RefreshCw, type LucideProps, X, Bot } from "lucide-react";
import { useAgents, useProviders, useModels } from "@/stores/useGlobalConfigStore";
import { useSpecialists } from "@/hooks/useSpecialists";
import type { Agent } from "@/types";

// Wrapper to fix React 19 + Lucide type compatibility
function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

export function AgentsPage() {
  const { agents, isLoading, error, fetchAgents } = useAgents();
  const { fetchProviders } = useProviders();
  const { fetchModels } = useModels();
  const { specialists, fetchSpecialists, toggleSpecialist } = useSpecialists();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>(undefined);

  useEffect(() => {
    fetchAgents();
    fetchProviders();
    fetchModels();
    fetchSpecialists();
  }, [fetchAgents, fetchProviders, fetchModels, fetchSpecialists]);

  // Specialist workers (sp_*) live inside their SpecialistCard, not the plain agent list.
  const configurableAgents = useMemo(
    () => agents.filter((a) => !a.specialistId),
    [agents],
  );
  const coordinator = useMemo(
    () => agents.find((a) => a.role === "coordinator"),
    [agents],
  );

  const handleSync = () => {
    fetchAgents();
    fetchSpecialists();
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingAgent(undefined);
    setIsFormOpen(true);
  };

  const handleSuccess = () => {
    setIsFormOpen(false);
    setEditingAgent(undefined);
  };

  return (
    <div className="hive-page mt-10 animate-in fade-in duration-700">
      <div className="hive-page-container">
        {/* Header Section */}
        <div className="hive-page-header flex flex-col sm:flex-row sm:items-end justify-between gap-6 relative z-10 mb-8">
          <div className="relative z-10 animate-in slide-in-from-left-8 duration-700">
            <div className="hive-page-header__eyebrow mb-3 opacity-80">
              <div className="hive-page-header__dot animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
              <span className="hive-page-header__label tracking-widest font-semibold text-blue-400">NEXO CENTRAL</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white drop-shadow-lg mb-4">
              Agentes <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Inteligentes</span>
            </h2>
            <p className="text-white/60 text-sm max-w-xl leading-relaxed font-light">
              Configura y despliega inteligencias autónomas. Cada nodo amplía las capacidades de tu infraestructura personal y de negocio con precisión absoluta.
            </p>
          </div>

          <div className="flex items-center gap-3 relative z-10 animate-in slide-in-from-right-8 duration-700">
            <button
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-all duration-300 flex items-center gap-2 font-medium text-sm backdrop-blur-sm group"
              onClick={handleSync}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 transition-transform duration-500 group-hover:rotate-180 text-blue-400 ${isLoading ? "animate-spin" : ""}`} />
              <span>Sincronizar</span>
            </button>

            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg border border-blue-500/50 hover:border-blue-400/50 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all duration-300 flex items-center gap-2 font-medium text-sm group"
            >
              <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
              <span>Desplegar Nodo</span>
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div className="relative mt-8">
          {/* Ambient Glows */}
          <div className="absolute -top-40 -left-40 h-[500px] w-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen opacity-50" />
          <div className="absolute top-40 -right-40 h-[400px] w-[400px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen opacity-50" />

          {error ? (
            <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/5 backdrop-blur-lg">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
              <div className="px-6 py-5 flex items-center gap-4 text-red-400 relative z-10">
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
                  <X className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest drop-shadow-sm">Error de Enlace</p>
                  <p className="text-sm text-red-300/70 mt-1 font-light">{error}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative z-10">
              {isLoading && configurableAgents.length === 0 ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-64 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
                  ))}
                </div>
              ) : configurableAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-white/5 rounded-3xl bg-black/20 backdrop-blur-sm animate-in fade-in duration-1000">
                  <div className="h-20 w-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                    <Bot className="h-10 w-10 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Colmena inactiva</h3>
                  <p className="text-white/50 max-w-md mx-auto mb-8 leading-relaxed">
                    La red neuronal está esperando ser poblada. Despliega tu primer nodo agente para comenzar a automatizar tus operaciones.
                  </p>
                  <button
                    onClick={handleCreate}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl border border-blue-500/50 hover:border-blue-400/50 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all duration-300 flex items-center gap-2 font-bold group"
                  >
                    <Plus className="h-5 w-5 transition-transform duration-300 group-hover:scale-125" />
                    <span>INICIAR DESPLIEGUE</span>
                  </button>
                </div>
              ) : (
                <div className="animate-in slide-in-from-bottom-8 duration-1000 fade-in fill-mode-both">
                  <AgentList agents={configurableAgents} onEdit={handleEdit} />
                </div>
              )}

              <SpecialistHivePanel
                specialists={specialists}
                coordinator={coordinator}
                onToggle={toggleSpecialist}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modern Overlay Form */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity"
            onClick={() => setIsFormOpen(false)}
          />
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-300">
            <AgentCreateForm
              initialData={editingAgent}
              onSuccess={handleSuccess}
              onCancel={() => setIsFormOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
