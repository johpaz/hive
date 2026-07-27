import { useEffect, useMemo } from "react";
import {
  Bot,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Code2,
  FileStack,
  Globe2,
  Loader2,
  Network,
  PackageOpen,
  Terminal,
  Wrench,
} from "lucide-react";
import { useSkills, useTools } from "@/stores/useGlobalConfigStore";
import type { Agent } from "@/types";
import { parseAssignments, type AssignedCapability } from "./agentCapabilities";

interface AgentToolsPanelProps {
  agent: Agent;
}

const CATEGORY_LABELS: Record<string, string> = {
  filesystem: "Archivos",
  web: "Web",
  cron: "Automatización",
  cli: "Terminal",
  agents: "Agentes",
  canvas: "Canvas",
  office: "Office",
  mcp: "MCP",
  core: "Sistema",
};

function inferCategory(id: string) {
  if (id.startsWith("fs_")) return "filesystem";
  if (id.startsWith("browser_") || id.startsWith("web_") || id === "search_knowledge") return "web";
  if (id.startsWith("cron")) return "cron";
  if (id.startsWith("office_")) return "office";
  if (id.startsWith("mcp") || id.includes("_mcp")) return "mcp";
  if (id.startsWith("canvas_") || id.startsWith("a2ui_")) return "canvas";
  if (id.startsWith("cli_")) return "cli";
  if (id.includes("agent") || id.includes("task_") || id.includes("acceptance")) return "agents";
  return "core";
}

function readableName(id: string) {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AgentToolsPanel({ agent }: AgentToolsPanelProps) {
  const { tools: registryTools, isLoading: toolsLoading, fetchTools } = useTools();
  const { skills: registrySkills, isLoading: skillsLoading, fetchSkills } = useSkills();

  useEffect(() => {
    if (registryTools.length === 0) fetchTools();
    if (registrySkills.length === 0) fetchSkills();
  }, [fetchSkills, fetchTools, registrySkills.length, registryTools.length]);

  const explicitTools = useMemo(() => parseAssignments(agent.toolsJson), [agent.toolsJson]);
  const explicitSkills = useMemo(() => parseAssignments(agent.skillsJson), [agent.skillsJson]);
  const baseToolIds = useMemo(
    () => agent.role === "coordinator" ? agent.minimalTools ?? [] : [],
    [agent.minimalTools, agent.role],
  );
  const baseSkills = useMemo(
    () => agent.role === "coordinator" ? agent.minimalSkills ?? [] : [],
    [agent.minimalSkills, agent.role],
  );

  const resolvedTools = useMemo(() => {
    const assignments = new Map<string, AssignedCapability & { source: "base" | "assigned" }>();
    baseToolIds.forEach((id) => assignments.set(id, { id, source: "base" }));
    explicitTools.forEach((tool) => {
      const existing = assignments.get(tool.id);
      assignments.set(tool.id, { ...tool, source: existing?.source ?? "assigned" });
    });

    return Array.from(assignments.values()).map((assigned) => {
      const registryTool = registryTools.find((tool) => tool.id === assigned.id);
      return {
        id: assigned.id,
        name: registryTool?.name || assigned.suppliedName || readableName(assigned.id),
        description: registryTool?.description || "Capacidad disponible en el loadout operativo de este agente.",
        category: registryTool?.category || inferCategory(assigned.id),
        available: registryTool ? registryTool.enabled && registryTool.active !== false : true,
        source: assigned.source,
      };
    });
  }, [baseToolIds, explicitTools, registryTools]);

  const resolvedSkills = useMemo(() => {
    const assignments = new Map<string, AssignedCapability & { source: "base" | "assigned" }>();
    baseSkills.forEach((skill) => assignments.set(skill.id, { id: skill.id, suppliedName: skill.name, source: "base" }));
    explicitSkills.forEach((skill) => {
      const existing = assignments.get(skill.id);
      assignments.set(skill.id, { ...skill, source: existing?.source ?? "assigned" });
    });

    return Array.from(assignments.values()).map((assigned) => {
      const registrySkill = registrySkills.find((skill) => skill.id === assigned.id);
      const baseSkill = baseSkills.find((skill) => skill.id === assigned.id);
      return {
        id: assigned.id,
        name: registrySkill?.name || baseSkill?.name || assigned.suppliedName || readableName(assigned.id),
        description:
          registrySkill?.description ||
          baseSkill?.description ||
          "Conocimiento operativo incluido en el contexto de este agente.",
        category: registrySkill?.category || baseSkill?.category || "core",
        source: assigned.source,
      };
    });
  }, [baseSkills, explicitSkills, registrySkills]);

  const categories = new Set(resolvedTools.map((tool) => tool.category)).size;
  const assignedMcpServers = agent.mcpServers ?? (agent.mcpServerIds ?? []).map((id) => ({
    id,
    name: id,
    status: "unknown",
    enabled: true,
    toolsCount: 0,
  }));
  const loading = (toolsLoading && registryTools.length === 0) || (skillsLoading && registrySkills.length === 0);

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e14]/75">
      <div className="flex flex-col gap-4 border-b border-white/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
            <Wrench className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/85">Loadout operativo</h2>
            <p className="mt-0.5 text-[11px] text-white/35">
              {agent.role === "coordinator"
                ? "Capacidades mínimas del coordinador y asignaciones adicionales"
                : "Tools y skills asignadas para ejecutar tareas"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <CapabilitySummary value={resolvedTools.length} label="tools" color="text-emerald-400" />
          <div className="h-7 w-px bg-white/[0.08]" />
          <CapabilitySummary value={resolvedSkills.length} label="skills" color="text-amber-400" />
          {assignedMcpServers.length > 0 && (
            <>
              <div className="h-7 w-px bg-white/[0.08]" />
              <CapabilitySummary value={assignedMcpServers.length} label="MCP" color="text-violet-400" />
            </>
          )}
          <div className="hidden h-7 w-px bg-white/[0.08] sm:block" />
          <div className="hidden sm:block">
            <CapabilitySummary value={categories} label="categorías" color="text-blue-400" />
          </div>
        </div>
      </div>

      {loading && resolvedTools.length === 0 && resolvedSkills.length === 0 && assignedMcpServers.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-14 text-xs text-white/35">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          Sincronizando loadout…
        </div>
      ) : resolvedTools.length === 0 && resolvedSkills.length === 0 && assignedMcpServers.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.025]">
            <PackageOpen className="h-5 w-5 text-white/20" />
          </div>
          <p className="mt-3 text-sm font-semibold text-white/60">Este agente no tiene capacidades asignadas</p>
          <p className="mt-1 text-xs text-white/30">Su loadout operativo está vacío.</p>
        </div>
      ) : (
        <>
          {resolvedTools.length > 0 && <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-emerald-400" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">Tools disponibles</h3>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {resolvedTools.map((tool) => {
                const ToolIcon = getCategoryIcon(tool.category);
                return (
                  <article
                    key={tool.id}
                    className="group rounded-xl border border-white/[0.07] bg-black/20 p-3.5 transition-colors hover:border-emerald-500/20 hover:bg-emerald-500/[0.025]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.035]">
                        <ToolIcon className="h-3.5 w-3.5 text-emerald-400/80" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-xs font-bold text-white/80" title={tool.name}>{tool.name}</h4>
                          <span title={tool.available ? "Disponible" : "No disponible"}>
                            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${tool.available ? "text-emerald-400" : "text-white/15"}`} />
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-white/30">{tool.description}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2">
                      <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-emerald-400/65">
                        {CATEGORY_LABELS[tool.category] || tool.category}
                      </span>
                      <SourceBadge source={tool.source} />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>}

          {assignedMcpServers.length > 0 && (
            <div className="border-t border-white/[0.07] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Network className="h-3.5 w-3.5 text-violet-400" />
                <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">Integraciones MCP asignadas</h3>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {assignedMcpServers.map((server) => (
                  <article key={server.id} className="rounded-xl border border-violet-500/15 bg-violet-500/[0.035] p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/[0.08]">
                        <Network className="h-3.5 w-3.5 text-violet-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-xs font-bold text-white/80" title={server.name}>{server.name}</h4>
                          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${server.enabled ? "bg-emerald-400" : "bg-white/20"}`} />
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-white/30">
                          Servidor completo · {server.toolsCount} tools sincronizadas
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2">
                      <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-violet-300/70">
                        {server.status}
                      </span>
                      <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-violet-200/70">
                        Persistente
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {resolvedSkills.length > 0 && (
            <div className="border-t border-white/[0.07] p-4">
              <div className="mb-3 flex items-center gap-2">
                <BookOpenCheck className="h-3.5 w-3.5 text-amber-400" />
                <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">Skills en contexto</h3>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {resolvedSkills.map((skill) => (
                  <article key={skill.id} className="rounded-xl border border-amber-500/10 bg-amber-500/[0.025] p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/15 bg-amber-500/[0.07]">
                        <BookOpenCheck className="h-3.5 w-3.5 text-amber-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-xs font-bold text-white/80" title={skill.name}>{skill.name}</h4>
                        <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-white/30">{skill.description}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2">
                      <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-amber-400/65">
                        {skill.category}
                      </span>
                      <SourceBadge source={skill.source} />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SourceBadge({ source }: { source: "base" | "assigned" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider ${
      source === "base"
        ? "bg-blue-500/10 text-blue-300/70"
        : "bg-white/5 text-white/25"
    }`}>
      {source === "base" ? "Minimal · base" : "Asignada"}
    </span>
  );
}

function CapabilitySummary({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="text-right">
      <p className={`text-base font-black tabular-nums ${color}`}>{value}</p>
      <p className="text-[8px] font-bold uppercase tracking-wider text-white/25">{label}</p>
    </div>
  );
}

function getCategoryIcon(category: string) {
  switch (category) {
    case "filesystem": return FileStack;
    case "web": return Globe2;
    case "cron": return CalendarClock;
    case "cli": return Terminal;
    case "agents": return Bot;
    case "canvas": return Code2;
    case "mcp": return Network;
    case "office": return FileStack;
    default: return Wrench;
  }
}
