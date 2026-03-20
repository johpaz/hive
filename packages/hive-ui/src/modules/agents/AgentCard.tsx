import { AgentStatusBadge } from "./AgentStatusBadge";
import type { Agent } from "@/types";
import { useNavigate } from "react-router-dom";
import {
  Cpu,
  MoreVertical,
  Edit2,
  Trash2,
  Shield,
  Activity,
  FileText,
  Wrench,
  Zap,
  Gauge,
  Lock,
  GitBranch,
  Calendar,
  FolderOpen
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAgents, useProviders, useModels } from "@/stores/useGlobalConfigStore";
import { swal } from "@/lib/swal";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface AgentCardProps {
  agent: Agent;
  onEdit?: (agent: Agent) => void;
}

export function AgentCard({ agent, onEdit }: AgentCardProps) {
  const navigate = useNavigate();
  const { deleteAgent } = useAgents();
  const { providers } = useProviders();
  const { models } = useModels();

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[role="menuitem"]') || (e.target as HTMLElement).closest('button')) {
      return;
    }
    navigate(`/agents/${agent.id}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await swal.fire({
      title: "¿Eliminar Agente?",
      text: `¿Estás seguro de que deseas eliminar al agente "${agent.name}"? Esta acción eliminará permanentemente su configuración.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
      background: "#09090b",
      color: "#fff",
      customClass: {
        popup: "border border-white/10 rounded-xl",
        confirmButton: "bg-red-500 hover:bg-red-600 text-white",
        cancelButton: "bg-white/10 hover:bg-white/20 text-white"
      }
    });
    if (result.isConfirmed) {
      try { await deleteAgent(agent.id); } catch (err) { console.error(err); }
    }
  };

  const isCoordinator = agent.role === 'coordinator';
  const providerId = agent.provider_id || agent.providerId;
  const modelId = agent.model_id || agent.modelId;
  const providerName = providers.find(p => p.id === providerId)?.name || providerId;
  const modelName = models.find(m => m.id === modelId)?.name || modelId;
  const displayStatus = agent.enabled ? agent.status : "hibernated";

  // Parse tools and skills from JSON
  const tools = agent.toolsJson ? JSON.parse(agent.toolsJson) as any[] : [];
  const skills = agent.skillsJson ? JSON.parse(agent.skillsJson) as any[] : [];
  const toolsCount = tools.length || 0;
  const skillsCount = skills.length || 0;
  const hasSystemPrompt = !!agent.systemPrompt;
  const maxIterations = agent.maxIterations || 10;

  const formatDate = (val?: string | number) => {
    if (!val) return null;
    try {
      return format(new Date(val), "dd MMM yyyy", { locale: es });
    } catch (e) {
      return null;
    }
  };

  const createdAt = formatDate(agent.created_at || agent.createdAt);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group relative overflow-hidden rounded-2xl border bg-black/40 backdrop-blur-xl transition-all duration-500 cursor-pointer flex flex-col h-full
        ${agent.enabled
          ? isCoordinator
            ? "border-purple-500/20 hover:border-purple-500/50 hover:bg-white/[0.03] hover:shadow-[0_0_30px_rgba(168,85,247,0.15)]"
            : "border-white/10 hover:border-blue-500/50 hover:bg-white/[0.03] hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]"
          : "border-white/5 opacity-70 grayscale hover:grayscale-0"}
      `}
      onClick={handleCardClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/agents/${agent.id}`); }}
    >
      {/* Top accent line */}
      {agent.enabled && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${isCoordinator ? "via-purple-500/60" : "via-blue-500/50"} to-transparent`} />
      )}

      {/* Background Gradient Effect */}
      {agent.enabled && (
        <div className={`absolute inset-0 bg-gradient-to-br ${isCoordinator ? "from-purple-500/10 via-transparent to-blue-500/5" : "from-blue-500/10 via-transparent to-purple-500/10"} opacity-0 transition-opacity duration-500 group-hover:opacity-100 pointer-events-none`} />
      )}

      <div className="p-5 flex flex-col flex-1 relative z-10">
        {/* Avatar + Role + Actions row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {/* Avatar circle */}
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border transition-colors
              ${isCoordinator
                ? "bg-purple-500/10 border-purple-500/20 group-hover:border-purple-500/40"
                : "bg-blue-500/10 border-blue-500/20 group-hover:border-blue-500/40"}`}>
              {isCoordinator
                ? <Shield className="h-5 w-5 text-purple-400" />
                : <Cpu className="h-5 w-5 text-blue-400" />}
            </div>
            {/* Name + role */}
            <div className="min-w-0">
              <h3 className={`text-base font-bold tracking-tight transition-colors truncate ${agent.enabled ? "text-white/95 group-hover:text-white" : "text-white/40"}`}>
                {agent.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border
                  ${isCoordinator
                    ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>
                  {isCoordinator ? "Coordinador" : "Worker"}
                </span>
                {agent.hasHeaders && (
                  <span title="Credenciales Mapeadas" className="flex items-center justify-center p-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                    <Lock className="h-2.5 w-2.5 text-emerald-400" />
                  </span>
                )}
                {agent.parentId && (
                  <span title="Sub-agente" className="flex items-center justify-center p-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                    <GitBranch className="h-2.5 w-2.5 text-amber-400" />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status + Actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <AgentStatusBadge status={displayStatus} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-black/90 backdrop-blur-xl border-white/10 text-white p-1 rounded-xl shadow-2xl">
                <DropdownMenuItem onClick={() => onEdit?.(agent)} className="gap-2 cursor-pointer focus:bg-white/10 focus:text-white rounded-lg px-3 py-2 text-sm transition-colors">
                  <Edit2 className="h-4 w-4 text-blue-400" />
                  <span>Editar Configuración</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="gap-2 cursor-pointer focus:bg-red-500/20 focus:text-red-400 rounded-lg px-3 py-2 text-sm text-red-400 transition-colors">
                  <Trash2 className="h-4 w-4" />
                  <span>Eliminar Agente</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-white/50 line-clamp-2 leading-relaxed font-light mb-1">
          {agent.description || "Sin descripción"}
        </p>

        {/* Tags */}
        <div className="mt-5 flex flex-wrap gap-2">
          {providerId && (
            <div className={`px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider flex items-center gap-1.5 border backdrop-blur-md transition-colors
              ${agent.enabled ? "bg-white/5 border-white/10 text-white/80 group-hover:bg-white/10 group-hover:border-white/20" : "bg-transparent border-white/5 text-white/30"}`}>
              <Cpu className="h-3 w-3" />
              {providerName}
            </div>
          )}
          {modelId && (
            <div className={`px-2.5 py-1 rounded-md text-[10px] font-medium tracking-wider border backdrop-blur-md transition-colors truncate max-w-[120px]
              ${agent.enabled ? "bg-white/5 border-white/10 text-white/80 group-hover:bg-white/10 group-hover:border-white/20" : "bg-transparent border-white/5 text-white/30"}`}
              title={modelName}>
              {modelName}
            </div>
          )}
          {agent.tone && (
            <div className={`px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider flex items-center gap-1.5 border backdrop-blur-md transition-colors
              ${agent.enabled ? "bg-white/5 border-white/10 text-white/80 group-hover:bg-white/10 group-hover:border-white/20" : "bg-transparent border-white/5 text-white/30"}`}>
              <Activity className="h-3 w-3" />
              {agent.tone}
            </div>
          )}
          {agent.workspace && (
            <div className={`px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider flex items-center gap-1.5 border backdrop-blur-md transition-colors
              ${agent.enabled ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30" : "bg-transparent border-white/5 text-white/30"}`}
              title={`Workspace: ${agent.workspace}`}>
              <FolderOpen className="h-3 w-3" />
              <span className="truncate max-w-[100px]">Workspace</span>
            </div>
          )}
        </div>

        {/* Dynamic configuration stats based on availability */}
        <div className="mt-6 pt-5 border-t border-white/5 grid grid-cols-4 gap-2">
          <div className="flex flex-col gap-1 items-start bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 flex items-center gap-1.5">
              <Wrench className="h-3 w-3 text-emerald-400/70" />
              Tools
            </span>
            <span className={`text-sm font-semibold font-mono ${agent.enabled ? "text-white/90" : "text-white/30"}`}>
              {toolsCount}
            </span>
          </div>
          <div className="flex flex-col gap-1 items-start bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-amber-400/70" />
              Skills
            </span>
            <span className={`text-sm font-semibold font-mono ${agent.enabled ? "text-white/90" : "text-white/30"}`}>
              {skillsCount}
            </span>
          </div>
          <div className="flex flex-col gap-1 items-start bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-blue-400/70" />
              Prompt
            </span>
            <span className={`text-sm font-bold ${agent.enabled ? (hasSystemPrompt ? "text-emerald-400" : "text-white/30") : "text-white/20"}`}>
              {hasSystemPrompt ? "✓" : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-1 items-start bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 flex items-center gap-1.5">
              <Gauge className="h-3 w-3 text-purple-400/70" />
              Iters
            </span>
            <span className={`text-sm font-semibold font-mono ${agent.enabled ? "text-white/90" : "text-white/30"}`}>
              {maxIterations}
            </span>
          </div>
        </div>

        {/* System Prompt */}
        {agent.systemPrompt && (
          <div className="mt-3 bg-white/[0.02] rounded-lg p-3 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-blue-400/70" />
              System Prompt
            </span>
            <p className="text-xs text-white/60 font-mono line-clamp-2 leading-relaxed italic">
              "{agent.systemPrompt}"
            </p>
          </div>
        )}

        {/* Extended Stats */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase">
              Tareas
            </span>
            <span className={`text-sm font-semibold font-mono ${agent.enabled ? "text-white/90" : "text-white/30"}`}>
              {agent.taskCount || 0}
            </span>
          </div>
          <div className="flex items-center justify-between bg-white/[0.02] rounded-lg p-2.5 border border-white/5 group-hover:border-white/10 transition-colors">
            <span className="text-[10px] font-medium tracking-wider text-white/40 uppercase">
              Éxito
            </span>
            <span className={`text-sm font-semibold font-mono ${agent.enabled ? "text-emerald-400/90" : "text-white/30"}`}>
              {agent.successRate || 0}%
            </span>
          </div>
        </div>

        {/* Footer: status indicator + Dates */}
        <div className="mt-auto pt-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${agent.enabled ? "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse" : "bg-white/20"}`} />
              <span className={`text-[10px] font-bold tracking-widest uppercase ${agent.enabled ? "text-blue-400" : "text-white/30"}`}>
                {agent.enabled ? "ACTIVO" : "INACTIVO"}
              </span>
            </div>
            {createdAt && (
              <div className="flex items-center gap-1.5 text-[10px] text-white/30 font-medium tracking-wider pl-3 border-l border-white/10">
                <Calendar className="h-3 w-3" />
                {createdAt}
              </div>
            )}
          </div>

          <div className={`text-xs font-semibold tracking-wide flex items-center gap-1.5 transition-all
            ${agent.enabled ? "text-white/70 group-hover:text-blue-400 translate-x-1 group-hover:translate-x-0" : "text-white/20"}`}>
            INGRESAR
            <span className="transition-transform group-hover:translate-x-1 opacity-0 group-hover:opacity-100 hidden sm:inline-block">→</span>
          </div>
        </div>
      </div>
    </div>
  );
}
