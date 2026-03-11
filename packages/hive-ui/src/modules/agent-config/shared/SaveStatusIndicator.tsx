import { Badge } from "@/components/ui/badge";
import { Check, Loader2, AlertCircle, Clock } from "lucide-react";
import type { SaveStatus } from "@/types";

interface SaveStatusIndicatorProps {
  status: SaveStatus;
}

const statusMap: Record<SaveStatus, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  saved: { label: "Guardado", icon: <Check className="h-3 w-3" />, variant: "secondary" },
  saving: { label: "Guardando…", icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "outline" },
  pending: { label: "Pendiente", icon: <Clock className="h-3 w-3" />, variant: "outline" },
  error: { label: "Error", icon: <AlertCircle className="h-3 w-3" />, variant: "destructive" },
};

export function SaveStatusIndicator({ status }: SaveStatusIndicatorProps) {
  const { label, icon, variant } = statusMap[status];
  return (
    <Badge variant={variant} className="gap-1 text-xs">
      {icon} {label}
    </Badge>
  );
}
