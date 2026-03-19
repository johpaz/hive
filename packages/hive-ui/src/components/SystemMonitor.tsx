import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemoryStick, HardDrive, Activity, Zap, Gauge, Play, History, Loader2, Server, MessageSquare } from "lucide-react";
import { apiClient } from "@/lib/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";

interface HiveMetrics {
  cpu: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    heapPercent: number;
    external: number;
  };
  uptime: string;
  connections: number;
  cores: number;
  recentMessages: number;
}

interface HistoryPoint {
  time: string;
  msgs: number;
  rss: number;
}

interface BenchmarkResult {
  timestamp: string;
  metrics: {
    name: string;
    duration: string;
    heapUsed: string;
    heapTotal: string;
    rss: string;
    external: string;
  };
}

function getColor(pct: number): string {
  if (pct < 50) return "#22c55e";
  if (pct < 80) return "#eab308";
  return "#ef4444";
}

export function SystemMonitor() {
  const [history, setHistory] = useState<HistoryPoint[]>(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => ({
      time: new Date(now.getTime() - (11 - i) * 5000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      msgs: 0,
      rss: 0,
    }));
  });

  const [benchHistory, setBenchHistory] = useState<BenchmarkResult[]>([]);

  const { data: metrics } = useQuery<HiveMetrics>({
    queryKey: ["system-stats"],
    queryFn: () => apiClient<HiveMetrics>("/api/system-stats"),
    refetchInterval: 5000,
  });

  const metricsRef = useRef(metrics);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);

  useEffect(() => {
    const id = setInterval(() => {
      const m = metricsRef.current;
      if (!m) return;
      const time = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setHistory(prev => [...prev, { time, msgs: m.recentMessages, rss: m.memory.rss }].slice(-20));
    }, 5000);
    return () => clearInterval(id);
  }, []);



  const rssMB = metrics?.memory.rss ?? 0;
  const heapUsed = metrics?.memory.heapUsed ?? 0;
  const external = metrics?.memory.external ?? 0;
  const recentMessages = metrics?.recentMessages ?? 0;

  return (
    <div className="flex flex-col gap-4 mb-4">
      <Card className="overflow-hidden border-primary/10">
        <CardHeader className="pb-2 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              Monitor del Proceso Hive
            </CardTitle>

          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-4">
          <MetricCard
            icon={MessageSquare}
            label="Actividad reciente"
            value={`${recentMessages}`}
            subValue="mensajes últimos 5 min"
            color={recentMessages > 0 ? "#22c55e" : "hsl(var(--muted-foreground))"}
            progress={Math.min(100, recentMessages * 10)}
          />
          <MetricCard
            icon={HardDrive}
            label="Memoria Hive (RSS)"
            value={`${rssMB} MB`}
            subValue={`Heap JS: ${heapUsed} MB usados`}
            color={getColor(Math.min(100, Math.round((rssMB / 1024) * 100)))}
            progress={Math.min(100, Math.round((rssMB / 1024) * 100))}
          />
          <MetricCard
            icon={MemoryStick}
            label="Heap JS"
            value={`${heapUsed} MB`}
            subValue={`External: ${external} MB`}
            color="#3b82f6"
            progress={Math.min(100, Math.round((heapUsed / 512) * 100))}
          />
          <MetricCard
            icon={Server}
            label="Sesiones WS activas"
            value={`${metrics?.connections ?? 0}`}
            subValue="conexiones WebSocket"
            color="#a855f7"
            progress={Math.min(100, (metrics?.connections ?? 0) * 10)}
          />
        </CardContent>
      </Card>

      <Card className="border-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Historial — <span className="text-green-400">Mensajes</span> · <span className="text-purple-400">RSS MB</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="gMsgs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gHeap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" axisLine={false} tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
              <Area type="monotone" dataKey="msgs" stroke="#22c55e" strokeWidth={2}
                fillOpacity={1} fill="url(#gMsgs)" name="Mensajes" />
              <Area type="monotone" dataKey="rss" stroke="#8b5cf6" strokeWidth={2}
                fillOpacity={1} fill="url(#gHeap)" name="RSS MB" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>


    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, subValue, color, progress,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subValue: string;
  color: string;
  progress: number;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ color }}><Icon className="h-4 w-4" /></span>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <span className="text-lg font-bold font-mono" style={{ color }}>{value}</span>
      </div>
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs text-muted-foreground">{subValue}</span>
      </div>
    </div>
  );
}
