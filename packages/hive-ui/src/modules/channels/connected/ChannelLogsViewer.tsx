import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { ChannelLog } from "@/types";

interface ChannelLogsViewerProps {
  logs: ChannelLog[];
  channelName?: string;
}

const logTypeColors: Record<string, string> = {
  info: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-hive-thinking/15 text-hive-thinking border-hive-thinking/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  debug: "bg-muted text-muted-foreground border-border",
};

export function ChannelLogsViewer({ logs, channelName }: ChannelLogsViewerProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Logs{channelName ? `: ${channelName}` : ""}</h3>
      <ScrollArea className="h-64">
        <div className="space-y-1 font-mono text-xs">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 rounded px-2 py-1 hover:bg-muted/50">
              <Badge variant="outline" className={`${logTypeColors[log.type]} text-[10px] shrink-0`}>
                {log.type}
              </Badge>
              <span className="text-muted-foreground shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span>{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="py-4 text-center text-muted-foreground">Sin logs recientes</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
