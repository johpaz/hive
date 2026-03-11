import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Bot,
  Layers,
  Cable,
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
import { SystemMonitor } from "@/components/SystemMonitor";
import { UsageStatsPanel } from "@/components/UsageStatsPanel";
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
  rss?: string;
  heap?: string;
  uptime?: number;
  cpu?: number;
  memory?: { used: number; total: number; percentage: number };
  connections?: number;
  cores?: number;
}

export function DashboardPage() {
  const { status: wsStatus } = useWebSocket();
  const { allAgents } = useAgents();

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

  const agents = useMemo(() => allAgents || [], [allAgents]);

  const statsCards = [
    { label: "Agentes Activos", value: agents.length, icon: Bot, color: "text-blue-500", trend: `${agents.filter(a => a.status === "active" || a.status === "thinking").length} en uso` },
    { label: "Sesiones Canvas", value: systemStats?.connections ?? 0, icon: Layers, color: "text-orange-500", trend: "Live" },
    { label: "Procesos Bridge", value: agents.filter(a => a.status === "thinking").length, icon: Cable, color: "text-purple-500", trend: "Estable" },
    { label: "Mensajes / 1h", value: activityData.at(-1)?.count ?? 0, icon: Activity, color: "text-green-500", trend: "Última hora" },
  ];

  const agentStatusData = useMemo(() => {
    const idle = agents.filter(a => a.status === "idle" || a.status === "hibernated").length;
    const active = agents.filter(a => a.status === "active").length;
    const thinking = agents.filter(a => a.status === "thinking").length;
    const error = agents.filter(a => a.status === "error").length;
    return [
      { name: "Idle", value: idle || 0, color: "hsl(var(--muted))" },
      { name: "Active", value: active || 0, color: "hsl(var(--primary))" },
      { name: "Thinking", value: thinking || 0, color: "hsl(var(--accent))" },
      ...(error > 0 ? [{ name: "Error", value: error, color: "#ef4444" }] : []),
    ].filter(d => d.value > 0 || d.name === "Idle");
  }, [agents]);

  const totalMessages = activityData.reduce((sum, d) => sum + d.count, 0);
  const systemHealth = systemStats?.memory?.percentage
    ? Math.max(0, Math.round(100 - systemStats.memory.percentage * 0.3 - (systemStats.cpu || 0) * 0.2))
    : 100;

  return (
    <div className="hive-page-container">
      {/* Header Sección */}
      <div className="hive-page-header">
        <div className="relative z-10">
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
          <div className="flex flex-col items-end">
            <span className="hive-label mb-1">Salud Global</span>
            <span className="text-xl font-black text-blue-400 tracking-tighter">{systemHealth}%</span>
          </div>
        </div>
      </div>

      {/* Sección de Pruebas */}
      {/* <div className="hive-card border-blue-500/20 bg-blue-500/5 mb-8">
        <div className="hive-card-body flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="hive-title-section mb-1">🐝 Terminal de Pruebas (Hive UI)</h3>
            <p className="text-xs text-white/40">Verifica la integración visual y reactiva del núcleo.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="hive-btn hive-btn--ghost text-xs"
              onClick={() => {
                const { showLoader, hideLoader } = useLoaderStore.getState();
                showLoader("Sincronizando con el enjambre...");
                setTimeout(hideLoader, 3000);
              }}
            >
              Simular Carga
            </button>
            <button
              className="hive-btn hive-btn--primary text-xs"
              onClick={() => {
                swal.fire({
                  title: "¡Bienvenido a la Colmena!",
                  text: "El sistema de alertas SweetAlert2 está configurado con éxito.",
                  icon: "success",
                  confirmButtonText: "¡Excelente!",
                });
              }}
            >
              Lanzar Alerta
            </button>
            <button
              className="hive-btn hive-btn--ghost text-xs border-purple-500/20 text-purple-400"
              onClick={() => {
                Toast.fire({
                  icon: "info",
                  title: "Miel recolectada con éxito"
                });
              }}
            >
              Notificación Toast
            </button>
          </div>
        </div>
      </div> */}

      {/* Grilla de Estadísticas */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
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

        {/* Distribución */}
        <div className="hive-card">
          <div className="hive-card-body">
            <h3 className="hive-title-section mb-6">Distribución de Agentes</h3>
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
                <span className="hive-stat__label">Salud Monitor</span>
                <span className="hive-stat__value hive-stat__value--active">Óptima</span>
              </div>
              <div className="hive-stat">
                <span className="hive-stat__label">Uptime</span>
                <span className="hive-stat__value hive-stat__value--active">{systemStats?.uptime ?? "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
