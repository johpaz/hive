import { useBridgeStore } from "@/stores/bridgeStore";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Terminal, CheckCircle2, XCircle, Loader2, StopCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-green-500/10 text-green-400 border-green-500/20",
  finished: "bg-green-500/10 text-green-400 border-green-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  stopped: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running": return <Loader2 className="h-3.5 w-3.5 text-yellow-400 animate-spin" />;
    case "completed":
    case "finished": return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "error": return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "stopped": return <StopCircle className="h-3.5 w-3.5 text-gray-400" />;
    default: return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function BridgeProcessList() {
  const processes = useBridgeStore((s) => s.processes);

  if (processes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <Terminal className="h-8 w-8 opacity-30 mb-2" />
        <p className="text-sm">Sin procesos activos</p>
        <p className="text-xs opacity-60 mt-1">Los comandos ejecutados por el agente aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-1">
      {processes.map((p) => (
        <div key={p.id} className="rounded-lg border border-border bg-card/50 p-3">
          <div className="flex items-start gap-2">
            <StatusIcon status={p.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium font-mono truncate">{p.name}</span>
                {p.pid > 0 && (
                  <span className="text-xs text-muted-foreground">PID: {p.pid}</span>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ml-auto ${STATUS_COLORS[p.status] ?? ""}`}
                >
                  {p.status}
                </Badge>
              </div>
              {p.command && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">$ {p.command}</p>
              )}
              {p.status === "running" && (
                <Progress value={undefined} className="h-0.5 mt-2" />
              )}
            </div>
          </div>

          {p.output.length > 0 && (
            <div className="mt-2 rounded bg-black/30 px-2 py-1.5 max-h-24 overflow-y-auto">
              <pre className="text-[10px] font-mono text-green-400/80 whitespace-pre-wrap break-all">
                {p.output.slice(-20).join("")}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
