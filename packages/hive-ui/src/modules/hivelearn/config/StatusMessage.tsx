import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface StatusMessageProps {
  type: "success" | "error" | "loading";
  message: string;
}

export function StatusMessage({ type, message }: StatusMessageProps) {
  if (type === "loading") {
    return (
      <div className="flex items-center gap-2.5 text-sm animate-in fade-in duration-300" style={{ color: "hsl(var(--hive-blue))" }}>
        <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
        <span>Guardando configuración...</span>
      </div>
    );
  }

  if (type === "success") {
    return (
      <div className="flex items-center gap-2.5 text-sm animate-in fade-in duration-300" style={{ color: "hsl(var(--hive-green))" }}>
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2.5 text-sm rounded-xl p-3 animate-in fade-in duration-300 border"
      style={{
        color: "hsl(var(--hive-red))",
        background: "hsl(var(--hive-red) / 0.05)",
        borderColor: "hsl(var(--hive-red) / 0.2)",
      }}
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
