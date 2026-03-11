import { cn } from "@/lib/utils";

interface ConnectionHealthIndicatorProps {
  latencyMs: number;
  errorRate: number;
}

export function ConnectionHealthIndicator({ latencyMs, errorRate }: ConnectionHealthIndicatorProps) {
  const health = errorRate > 0.1 ? "critical" : errorRate > 0.03 ? "degraded" : latencyMs > 3000 ? "degraded" : "healthy";
  const color = health === "healthy" ? "bg-hive-connected" : health === "degraded" ? "bg-hive-thinking" : "bg-destructive";
  const label = health === "healthy" ? "Saludable" : health === "degraded" ? "Degradado" : "Crítico";

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-muted-foreground/60">({latencyMs}ms)</span>
    </div>
  );
}
