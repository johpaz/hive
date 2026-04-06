import { ArrowRight } from "lucide-react";

interface ConfigSummaryProps {
  providerName: string;
  modelName: string;
  agentCount: number;
}

export function ConfigSummary({ providerName, modelName, agentCount }: ConfigSummaryProps) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{
        borderColor: "hsl(var(--hive-blue) / 0.2)",
        background: "hsl(var(--hive-blue) / 0.05)",
        boxShadow: "0 0 25px hsl(var(--hive-blue) / 0.06)",
      }}
    >
      <div className="text-[9px] uppercase tracking-[0.2em] mb-2 font-bold" style={{ color: "hsl(var(--hive-blue) / 0.6)" }}>
        Configuración seleccionada
      </div>
      <div className="text-sm flex items-center gap-3" style={{ color: "hsl(var(--hive-surface-foreground))" }}>
        <span className="font-bold" style={{ color: "hsl(var(--hive-blue))" }}>{providerName}</span>
        <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "hsl(var(--hive-blue) / 0.4)" }} />
        <span className="font-bold" style={{ color: "hsl(var(--hive-blue))" }}>{modelName}</span>
      </div>
      <div className="text-[11px] mt-2 font-mono tracking-wide" style={{ color: "hsl(var(--hive-muted-foreground))" }}>
        Se aplicará a los {agentCount} agentes del enjambre
      </div>
    </div>
  );
}
