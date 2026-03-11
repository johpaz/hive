import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DollarSign, Hash, Activity, Clock, TrendingUp, Server, Bot, Zap } from "lucide-react";
import { apiClient } from "@/lib/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
  Tooltip
} from "recharts";

interface UsageStats {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  toonSavedTokens: number;
  toonSavedCost: number;
  toonSavingsPercent: number;
  byProvider: Record<string, { tokens: number; costUsd: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { tokens: number; costUsd: number; provider: string; inputTokens: number; outputTokens: number }>;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d97706",
  openai: "#10b981",
  google: "#3b82f6",
  gemini: "#3b82f6",
  deepseek: "#8b5cf6",
  kimi: "#ec4899",
  ollama: "#14b8a6",
  openrouter: "#f59e0b",
  mistral: "#6366f1",
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatCurrency(usd: number): string {
  if (usd >= 1) return "$" + usd.toFixed(2);
  return "$" + usd.toFixed(4);
}

export function UsageStatsPanel() {
  const [period, setPeriod] = useState<number>(24);

  const { data: stats, isLoading } = useQuery<UsageStats>({
    queryKey: ["usage-stats", period],
    queryFn: async () => {
      const data = await apiClient<UsageStats>(`/api/usage-stats?hours=${period}`);
      console.log("[UsageStatsPanel] Received stats:", {
        totalTokens: data.totalTokens,
        totalCostUsd: data.totalCostUsd,
        providers: Object.keys(data.byProvider || {}).length
      });
      return data;
    },
    refetchInterval: 60000,
  });

  if (isLoading && !stats) {
    return (
      <Card className="border-primary/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Uso y Costos de API
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 flex items-center justify-center text-muted-foreground animate-pulse">
            Cargando estadísticas de uso...
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasData = stats && (stats.totalTokens > 0 || stats.totalCostUsd > 0);

  const providerData = stats ? Object.entries(stats.byProvider).map(([provider, data]) => ({
    name: provider.charAt(0).toUpperCase() + provider.slice(1),
    value: data.tokens,
    cost: data.costUsd,
    color: PROVIDER_COLORS[provider.toLowerCase()] || "#6b7280"
  })) : [];

  const modelData = stats ? Object.entries(stats.byModel).slice(0, 8).map(([model, data]) => ({
    name: model.length > 20 ? model.slice(0, 18) + "..." : model,
    tokens: data.tokens,
    cost: data.costUsd,
    fullName: model
  })) : [];

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Uso y Costos de API
            </CardTitle>
            <CardDescription>Tokens consumidos y costos por provider/modelo</CardDescription>
          </div>
          <div className="flex gap-1">
            {[6, 24, 168].map((h) => (
              <button
                key={h}
                onClick={() => setPeriod(h)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${period === h
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
                  }`}
              >
                {h === 6 ? "6h" : h === 24 ? "24h" : "7d"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* TOON Ahorro: siempre visible */}
        <div className={`rounded-lg border p-3 ${stats?.toonSavedTokens ? "border-emerald-500/30 bg-emerald-500/5" : "bg-card/50"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className={`h-3 w-3 ${stats?.toonSavedTokens ? "text-emerald-400" : ""}`} />
              <span className="font-medium">TOON Ahorro de Tokens</span>
            </div>
            {stats?.toonSavingsPercent ? (
              <span className="text-xs font-bold text-emerald-400">{stats.toonSavingsPercent.toFixed(1)}% reducción</span>
            ) : null}
          </div>
          <div className="mt-2 flex items-end gap-4">
            <div>
              <div className={`text-2xl font-bold ${stats?.toonSavedTokens ? "text-emerald-400" : "text-muted-foreground"}`}>
                {stats ? formatNumber(stats.toonSavedTokens) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">tokens ahorrados</div>
            </div>
            {stats ? (
              <div className="text-sm font-semibold text-emerald-400">{formatCurrency(stats.toonSavedCost)} USD</div>
            ) : null}
            {stats && !stats.toonSavedTokens && (
              <div className="text-xs text-muted-foreground italic">Sin optimizaciones TOON aún</div>
            )}
          </div>
        </div>

        {!hasData ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay datos de uso aún</p>
              <p className="text-xs">Los tokens se registrarán automáticamente</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <DollarSign className="h-3 w-3" />
                  Costo Total
                </div>
                <div className="text-2xl font-bold text-green-500">
                  {formatCurrency(stats.totalCostUsd)}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Hash className="h-3 w-3" />
                  Total Tokens
                </div>
                <div className="text-2xl font-bold">
                  {formatNumber(stats.totalTokens)}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3" />
                  Input / Output
                </div>
                <div className="text-lg font-semibold">
                  <span className="text-blue-500">{formatNumber(stats.totalInputTokens)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-purple-500">{formatNumber(stats.totalOutputTokens)}</span>
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Server className="h-3 w-3" />
                  Providers
                </div>
                <div className="text-2xl font-bold">
                  {Object.keys(stats.byProvider).length}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  Por Provider
                </h4>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={providerData} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                        formatter={(value: number, name: string) => [
                          name === "cost" ? formatCurrency(value) : formatNumber(value),
                          name === "cost" ? "Costo" : "Tokens"
                        ]}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                        {providerData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  Por Modelo (Top 8)
                </h4>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelData}>
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }}
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => {
                          const model = modelData.find(m => m.name === label);
                          return model?.fullName || label;
                        }}
                      />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                        {modelData.map((entry) => (
                          <Cell
                            key={entry.fullName}
                            fill={PROVIDER_COLORS[entry.fullName.split("-")[0]?.toLowerCase()] || "#6b7280"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {providerData.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Detalle por Provider</h4>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Provider</th>
                        <th className="text-right p-2 font-medium">Input</th>
                        <th className="text-right p-2 font-medium">Output</th>
                        <th className="text-right p-2 font-medium">Total</th>
                        <th className="text-right p-2 font-medium">Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(stats.byProvider).map(([provider, data]) => (
                        <tr key={provider} className="border-t">
                          <td className="p-2 font-medium">{provider}</td>
                          <td className="p-2 text-right text-blue-500">{formatNumber(data.inputTokens)}</td>
                          <td className="p-2 text-right text-purple-500">{formatNumber(data.outputTokens)}</td>
                          <td className="p-2 text-right">{formatNumber(data.tokens)}</td>
                          <td className="p-2 text-right font-medium text-green-500">{formatCurrency(data.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
