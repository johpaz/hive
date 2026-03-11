import { Badge } from "@/components/ui/badge";
import type { AgentStatus } from "@/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  active: { label: "Activo", className: "bg-hive-connected/15 text-hive-connected border-hive-connected/30" },
  idle: { label: "Activo", className: "bg-hive-connected/10 text-hive-connected/80 border-hive-connected/20" },
  hibernated: { label: "Hibernado", className: "bg-secondary text-secondary-foreground border-border" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive border-destructive/30" },
  thinking: { label: "Pensando", className: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30 animate-pulse-slow" },
};

interface AgentStatusBadgeProps {
  status: AgentStatus;
  className?: string;
}

export function AgentStatusBadge({ status, className }: AgentStatusBadgeProps) {
  if (!status || !statusConfig[status]) {
    return (
      <Badge variant="outline" className={className}>
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
        Desconocido
      </Badge>
    );
  }
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
    </Badge>
  );
}
