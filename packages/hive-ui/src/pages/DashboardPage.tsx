import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Bot,
  Layers,
  Activity,
  ArrowUpRight,
  type LucideProps
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgents } from "@/hooks/useAgents";
import { useCanvasStore } from "@/stores/canvasStore";
import { useOfficeModel } from "@/modules/office3d/state/useOfficeModel";
import { SystemMonitor } from "@/components/SystemMonitor";
import { UsageStatsPanel } from "@/components/UsageStatsPanel";
import { UpdateChecker } from "@/components/UpdateChecker";
import { useLoaderStore } from "@/stores/useLoaderStore";
import { swal, Toast } from "@/lib/swal";
import { apiClient } from "@/lib/api";

// Wrapper component to fix React 19 + Lucide type compatibility issue
function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

interface ActivityData {
  time: string;
  count: number;
}

interface SystemStats {
  cpu?: number;
  memory?: { rss: number; heapUsed: number; heapTotal: number; heapPercent: number; external: number };
  uptime?: string;
  connections?: number;
  cores?: number;
  recentMessages?: number;
}

interface AgentProposal {
  id: string;
  agentId: string;
  agentName: string;
  reason: string | null;
  confidence: number;
  createdAt: number;
}

// Known curator.ts reason codes (disable_agent proposals) translated for display.
// Anything not listed here falls back to the raw string it sent.
const PROPOSAL_REASONS: Record<string, string> = {
  "harmful_count exceeded helpful_count": "más resultados dañinos que útiles en sus verificaciones",
};

function describeProposalReason(reason: string | null): string {
  if (!reason) return "revisión pendiente";
  return PROPOSAL_REASONS[reason] ?? reason;
}

export function DashboardPage() {
  const { status: wsStatus } = useWebSocket();
  const { allAgents } = useAgents();
  const graphNodes = useCanvasStore((s) => s.graphNodes);

  const { data: systemStats } = useQuery<SystemStats>({
    queryKey: ["system-stats"],
    queryFn: () => apiClient<SystemStats>("/api/system-stats"),
    refetchInterval: 5000,
  });

  const { data: activityData = [] } = useQuery<ActivityData[]>({
    queryKey: ["activity-stats"],
    queryFn: () => apiClient<ActivityData[]>("/api/activity-stats?hours=12"),
    refetchInterval: 60000,
  });

  // Pending curator review queue (curator.ts raises a "disable_agent"
  // proposal instead of silently disabling a misbehaving catalog agent).
  const { data: proposals = [] } = useQuery<AgentProposal[]>({
    queryKey: ["agent-proposals"],
    queryFn: () => apiClient<{ proposals: AgentProposal[] }>("/api/agents/proposals").then(r => r.proposals),
    refetchInterval: 30000,
  });

  const agents = useMemo(() => allAgents || [], [allAgents]);
  // Live status (idle/thinking/tool_call/stuck) lives only in the WS canvas
  // graph, not on the agent's DB row — same source the 3D office uses.
  const catalogAgents = useMemo(() => agents.filter((a) => a.source === "catalog"), [agents]);
  const { desks } = useOfficeModel(catalogAgents, graphNodes);
  const workingCount = desks.filter(d => d.state === "thinking" || d.state === "tool_call").length;

  const statsCards = [
    { label: "Agentes Activos", value: agents.length, icon: Bot, color: "text-blue-500", trend: `${workingCount} trabajando` },
    { label: "Sesiones Canvas", value: systemStats?.connections ?? 0, icon: Layers, color: "text-orange-500", trend: "Live" },
    { label: "Mensajes / 1h", value: activityData.at(-1)?.count ?? 0, icon: Activity, color: "text-green-500", trend: "Última hora" },
  ];

  const agentStatusData = useMemo(() => {
    const idle = desks.filter(d => d.state === "idle").length;
    const stuck = desks.filter(d => d.state === "stuck").length;
    const disabled = desks.filter(d => d.state === "disabled").length;
    return [
      { name: "Idle", value: idle, color: "hsl(var(--muted))" },
      { name: "Trabajando", value: workingCount, color: "hsl(var(--primary))" },
      ...(stuck > 0 ? [{ name: "Atascado", value: stuck, color: "#ef4444" }] : []),
      ...(disabled > 0 ? [{ name: "Deshabilitado", value: disabled, color: "hsl(var(--muted-foreground))" }] : []),
    ].filter(d => d.value > 0 || d.name === "Idle");
  }, [desks, workingCount]);

  const totalMessages = activityData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="hive-page-container">
      {/* Header Sección */}
      <div className="hive-page-header">
        <div className="relative z-10 flex items-center gap-4">
          <div className="hidden h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-2 shadow-[0_0_30px_rgba(59,130,246,0.12)] sm:flex">
            <img
              src="/logocolor-dark.png"
              alt="Logo de Hive"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <div className="hive-page-header__eyebrow">
              <div className="hive-page-header__dot" />
              <span className="hive-page-header__label">SISTEMA OPERATIVO HIVE</span>
            </div>
            <h2 className="hive-title-page">
              Centro de <span className="hive-title-page__accent">Control</span>
            </h2>
            <p className="hive-subtitle">
              Monitoreo en tiempo real del enjambre y estado de los nodos cognitivos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 relative z-10">
          <div className="flex flex-col items-end">
            <span className="hive-label mb-1">Estado Hive</span>
            <div className="flex items-center gap-2">
              <div className={wsStatus === "connected" ? "hive-status-dot--active" : "hive-status-dot--disabled"} />
              <span className={wsStatus === "connected" ? "hive-status-label--active" : "hive-status-label--disabled"}>
                {wsStatus === "connected" ? "EN LÍNEA" : "DESCONECTADO"}
              </span>
            </div>
          </div>
          <div className="h-10 w-px bg-white/10 hidden sm:block" />
          <UpdateChecker />
        </div>
      </div>

      {/* Grilla de Estadísticas */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {statsCards.map((card) => (
          <div key={card.label} className="hive-card hive-card--active group">
            <div className="hive-card-body">
              <div className="flex flex-row items-center justify-between mb-4">
                <span className="hive-title-section">{card.label}</span>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <Icon icon={card.icon} className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-black text-white group-hover:text-blue-400 transition-colors">
                    {card.value}
                  </div>
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-1 flex items-center gap-1">
                    <ArrowUpRight className="h-2.5 w-2.5 text-green-500" />
                    {card.trend}
                  </p>
                </div>
                <div className="h-8 w-8 rounded-full border border-white/5 bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowUpRight className="h-4 w-4 text-blue-400" />
                </div>
              </div>
            </div>
            <div className="hive-strip--bottom" />
          </div>
        ))}
      </div>

      {/* System Monitor - Real-time metrics */}
      <SystemMonitor />

      {/* Usage Stats - Tokens and Costs */}
      <UsageStatsPanel />

      {/* Sección de Gráficos */}
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        {/* Actividad */}
        <div className="lg:col-span-2 hive-card">
          <div className="hive-card-body !pb-0">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="hive-title-section">Actividad del Enjambre</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                  Últimas 12 horas · {totalMessages} mensajes
                </p>
              </div>
              <Activity className="h-5 w-5 text-blue-500 animate-pulse shadow-blue-glow" />
            </div>
            <div className="h-[280px] w-full">
              {activityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activityData}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="time"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 'bold' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 'bold' }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#09090b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                      itemStyle={{ color: '#3b82f6' }}
                      formatter={(v: number) => [v, "Mensajes"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      strokeWidth={4}
                      fillOpacity={1}
                      fill="url(#colorCount)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-white/30 text-sm">
                  Cargando actividad...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Salud del Enjambre */}
        <div className="hive-card">
          <div className="hive-card-body">
            <h3 className="hive-title-section mb-6">Salud del Enjambre</h3>
            <div className="h-[210px]">
              {agentStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agentStatusData} layout="vertical">
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' }}
                      width={70}
                    />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                    <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
                      {agentStatusData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-white/30 text-sm">
                  Sin agentes configurados
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
              <div className="hive-stat">
                <span className="hive-stat__label">Necesitan atención</span>
                <span
                  className="hive-stat__value hive-stat__value--active"
                  style={proposals.length > 0 ? { color: "#ef4444" } : undefined}
                >
                  {proposals.length}
                </span>
              </div>
              <div className="hive-stat">
                <span className="hive-stat__label">Uptime</span>
                <span className="hive-stat__value hive-stat__value--active">{systemStats?.uptime ?? "—"}</span>
              </div>
            </div>

            {proposals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
                {proposals.map((p) => (
                  <div key={p.id} className="flex items-baseline gap-1.5 text-[10px]" title={p.reason ?? undefined}>
                    <span className="text-red-400">●</span>
                    <span className="text-white/70 font-bold truncate">{p.agentName}</span>
                    <span className="text-white/30 truncate">— {describeProposalReason(p.reason)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
