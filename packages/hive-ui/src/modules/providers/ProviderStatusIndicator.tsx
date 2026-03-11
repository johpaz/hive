import { Badge } from "@/components/ui/badge";
import type { ProviderStatus } from "@/types";

const statusConfig: Record<ProviderStatus, { label: string; className: string }> = {
  active: { label: "Activo", className: "bg-hive-connected/15 text-hive-connected border-hive-connected/30" },
  fallback: { label: "Fallback", className: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive border-destructive/30" },
  disabled: { label: "Desactivado", className: "bg-muted text-muted-foreground border-border" },
};

interface ProviderStatusIndicatorProps {
  status: ProviderStatus;
}

export function ProviderStatusIndicator({ status }: ProviderStatusIndicatorProps) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
    </Badge>
  );
}
