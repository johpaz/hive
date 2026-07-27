import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  FolderOpen,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { AgentCreateForm } from "@/modules/agents/AgentCreateForm";
import { AgentList } from "@/modules/agents/AgentList";
import { getAgentSkillIds, getAgentToolIds } from "@/modules/agents/agentCapabilities";
import { useAgents, useModels, useProviders } from "@/stores/useGlobalConfigStore";
import type { Agent } from "@/types";

export function AgentsPage() {
  const navigate = useNavigate();
  const { agents, isLoading, error, fetchAgents } = useAgents();
  const { providers, fetchProviders } = useProviders();
  const { models, fetchModels } = useModels();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>();
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    fetchAgents();
    fetchProviders();
    fetchModels();
  }, [fetchAgents, fetchProviders, fetchModels]);

  const coordinator = useMemo(
    () => agents.find((agent) => agent.role === "coordinator") ?? agents[0],
    [agents],
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedId) ?? coordinator;
  const activeCount = agents.filter((agent) => agent.enabled).length;
  const workerCount = agents.filter((agent) => agent.role === "worker").length;

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingAgent(undefined);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingAgent(undefined);
  };

  return (
    <div className="hive-page min-h-full">
      <div className="mx-auto w-full max-w-[1480px] px-2 py-4 sm:px-4 lg:px-6 lg:py-6">
        <header className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e14]/80 px-5 py-5 shadow-xl shadow-black/10 sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(59,130,246,0.10),transparent_28%),radial-gradient(circle_at_8%_100%,rgba(245,158,11,0.08),transparent_32%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2.5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.24em] text-blue-400">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                Nexo central · configuración de agentes
              </div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">
                Tu colmena <span className="text-amber-400">inteligente</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
                Selecciona un nodo para revisar su configuración, ajustar su propósito o entrar a su espacio operativo.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="hidden items-center gap-4 xl:flex">
                <HeaderMetric value={activeCount} label="activos" color="text-emerald-400" />
                <HeaderMetric value={workerCount} label="especialistas" color="text-blue-400" />
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fetchAgents()}
                  disabled={isLoading}
                  className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3.5 text-xs font-semibold text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${isLoading ? "animate-spin" : ""}`} />
                  Sincronizar
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex h-10 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-400 px-4 text-xs font-bold text-[#181108] shadow-[0_0_20px_rgba(245,158,11,0.16)] transition hover:bg-amber-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Desplegar nodo
                </button>
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-4 text-red-300">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Error de enlace</p>
              <p className="mt-1 text-sm text-red-300/60">{error}</p>
            </div>
          </div>
        ) : isLoading && agents.length === 0 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="h-[560px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
            <div className="h-[560px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
          </div>
        ) : agents.length === 0 ? (
          <div className="mt-5 flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
              <Bot className="h-7 w-7 text-amber-400" />
            </div>
            <h2 className="mt-5 text-lg font-bold text-white">Colmena inactiva</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/40">
              Despliega el primer agente para crear el núcleo de tu red.
            </p>
            <button
              type="button"
              onClick={handleCreate}
              className="mt-6 flex h-10 items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-bold text-[#181108]"
            >
              <Plus className="h-4 w-4" />
              Desplegar primer nodo
            </button>
          </div>
        ) : (
          <div className="mt-5 grid items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
            <AgentInspector
              agent={selectedAgent}
              providerName={
                providers.find((provider) => provider.id === (selectedAgent?.provider_id || selectedAgent?.providerId))?.name
              }
              modelName={
                models.find((model) => model.id === (selectedAgent?.model_id || selectedAgent?.modelId))?.name
              }
              totalAgents={agents.length}
              activeCount={activeCount}
              onEdit={handleEdit}
              onOpen={(agent) => navigate(`/agents/${agent.id}`)}
            />

            <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080b11]/75 shadow-2xl shadow-black/15">
              <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">
                    <Network className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-white/80">Mapa de la colmena</h2>
                    <p className="mt-0.5 text-[10px] text-white/30">Haz clic en un hexágono para inspeccionarlo</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    Coordinación
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                    Especialistas
                  </span>
                </div>
              </div>

              <div className="relative min-h-[560px] overflow-hidden">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(245,158,11,0.045),transparent_38%)]" />
                <AgentList
                  agents={agents}
                  onEdit={handleEdit}
                  selectedId={selectedAgent?.id}
                  onSelect={setSelectedId}
                />
              </div>
            </section>
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="Cerrar configuración"
            className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
            onClick={closeForm}
          />
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-[#09090b] shadow-2xl">
            <AgentCreateForm initialData={editingAgent} onSuccess={closeForm} onCancel={closeForm} />
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderMetric({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-black tabular-nums ${color}`}>{value}</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/25">{label}</span>
    </div>
  );
}

function AgentInspector({
  agent,
  providerName,
  modelName,
  totalAgents,
  activeCount,
  onEdit,
  onOpen,
}: {
  agent?: Agent;
  providerName?: string;
  modelName?: string;
  totalAgents: number;
  activeCount: number;
  onEdit: (agent: Agent) => void;
  onOpen: (agent: Agent) => void;
}) {
  if (!agent) return null;

  const isCoordinator = agent.role === "coordinator";
  const providerId = agent.provider_id || agent.providerId;
  const modelId = agent.model_id || agent.modelId;
  const tools = getAgentToolIds(agent).length;
  const skills = getAgentSkillIds(agent).length;

  return (
    <aside className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e14]/90 lg:sticky lg:top-4">
      <div className={`h-1 w-full ${isCoordinator ? "bg-amber-400" : "bg-blue-500"}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
              isCoordinator
                ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                : "border-blue-500/20 bg-blue-500/10 text-blue-400"
            }`}
          >
            {isCoordinator ? <Shield className="h-5 w-5" /> : <BrainCircuit className="h-5 w-5" />}
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${
              agent.status === "archived"
                ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                : agent.enabled
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-white/10 bg-white/5 text-white/35"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                agent.status === "archived" ? "bg-amber-400" : agent.enabled ? "bg-emerald-400" : "bg-white/30"
              }`}
            />
            {agent.status === "archived" ? "Archivado" : agent.enabled ? "Activo" : "Inactivo"}
          </span>
        </div>

        <p className={`mt-4 text-[9px] font-bold uppercase tracking-[0.2em] ${isCoordinator ? "text-amber-400" : "text-blue-400"}`}>
          {isCoordinator ? "Nodo coordinador" : "Nodo especialista"}
        </p>
        <h2 className="mt-1.5 text-xl font-black leading-tight tracking-tight text-white">{agent.name}</h2>
        <p className="mt-2 line-clamp-3 min-h-[54px] text-xs leading-[18px] text-white/40">
          {agent.description || "Este agente todavía no tiene una descripción de propósito."}
        </p>

        <div className="mt-5 space-y-2">
          <InspectorRow icon={BrainCircuit} label="Motor" value={providerName || providerId || "Sin proveedor"} />
          <InspectorRow icon={Sparkles} label="Modelo" value={modelName || modelId || "Sin modelo"} />
          <InspectorRow icon={FolderOpen} label="Workspace" value={agent.workspace || "Sin asignar"} mono={Boolean(agent.workspace)} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <InspectorStat icon={Wrench} value={tools} label="Tools" color="text-emerald-400" />
          <InspectorStat icon={Zap} value={skills} label="Skills" color="text-amber-400" />
          <InspectorStat icon={Activity} value={agent.maxIterations || 10} label="Iters" color="text-violet-400" />
        </div>

        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={() => onEdit(agent)}
            className={`flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-bold transition-colors ${
              isCoordinator
                ? "bg-amber-400 text-[#181108] hover:bg-amber-300"
                : "bg-blue-600 text-white hover:bg-blue-500"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Configurar nodo
          </button>
          <button
            type="button"
            onClick={() => onOpen(agent)}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            Abrir perfil
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-white/[0.07] bg-white/[0.07]">
        <div className="bg-[#0b0e14] px-4 py-3">
          <p className="text-lg font-black tabular-nums text-white">{totalAgents}</p>
          <p className="text-[8px] font-bold uppercase tracking-wider text-white/25">Nodos totales</p>
        </div>
        <div className="bg-[#0b0e14] px-4 py-3">
          <p className="text-lg font-black tabular-nums text-emerald-400">{activeCount}</p>
          <p className="text-[8px] font-bold uppercase tracking-wider text-white/25">En operación</p>
        </div>
      </div>
    </aside>
  );
}

function InspectorRow({
  icon: RowIcon,
  label,
  value,
  mono = false,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <RowIcon className="h-3.5 w-3.5 shrink-0 text-white/30" />
      <div className="min-w-0">
        <p className="text-[8px] font-bold uppercase tracking-wider text-white/25">{label}</p>
        <p className={`mt-0.5 truncate text-[11px] text-white/65 ${mono ? "font-mono" : "font-medium"}`} title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function InspectorStat({
  icon: StatIcon,
  value,
  label,
  color,
}: {
  icon: typeof Wrench;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-2.5 text-center">
      <StatIcon className={`mx-auto h-3.5 w-3.5 ${color}`} />
      <p className="mt-1 text-sm font-black tabular-nums text-white/80">{value}</p>
      <p className="text-[7px] font-bold uppercase tracking-wider text-white/25">{label}</p>
    </div>
  );
}
