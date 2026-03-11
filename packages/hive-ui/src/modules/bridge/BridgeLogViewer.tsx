import { useBridgeStore } from "@/stores/bridgeStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Terminal } from "lucide-react";

const LEVEL_COLORS: Record<string, string> = {
  info: "text-foreground/80",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-muted-foreground/60",
};

const LEVEL_PREFIX: Record<string, string> = {
  info: "  ",
  warn: "! ",
  error: "✗ ",
  debug: "· ",
};

export function BridgeLogViewer() {
  const logs = useBridgeStore((s) => s.logs);
  const clearLogs = useBridgeStore((s) => s.clearLogs);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          <span className="font-mono uppercase tracking-wider">Terminal Log</span>
          <span className="text-muted-foreground/50">({logs.length})</span>
        </div>
        {logs.length > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearLogs}>
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground/50">
            <p>No logs yet — run a command to see output here</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {logs.map((log) => (
              <div key={log.id} className={`flex gap-2 ${LEVEL_COLORS[log.level] ?? "text-foreground/80"}`}>
                <span className="text-muted-foreground/40 shrink-0 w-[72px] truncate">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="shrink-0 w-4">{LEVEL_PREFIX[log.level] ?? "  "}</span>
                <span className="break-all whitespace-pre-wrap">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
