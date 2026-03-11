import { useEffect, useState, useRef, useMemo } from "react";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Search, Trash2, Pause, Play, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLevels, setFilterLevels] = useState<string[]>(["info", "warn", "error"]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { url, status, subscribe, send } = useWebSocket();

  const parseRawLog = (line: string): LogEntry => {
    // Attempt to parse standard format: [timestamp] [CORR] [LEVEL] message {meta}
    // Simple regex for [timestamp] [LEVEL] message
    const match = line.match(/^\[(.*?)\]\s?(?:\[.*?\])?\s?\[(DEBUG|INFO|WARN|ERROR)\]\s(.*)$/i);
    if (match) {
      const [, timestamp, level, rest] = match;
      // Check if there is JSON meta at the end
      let message = rest;
      let meta: any = undefined;
      const metaMatch = rest.match(/^(.*)\s({.*})$/);
      if (metaMatch) {
        message = metaMatch[1];
        try { meta = JSON.parse(metaMatch[2]); } catch { /* ignore */ }
      }
      return {
        timestamp,
        level: level.toLowerCase() as any,
        source: "core",
        message,
        meta
      };
    }
    return {
      timestamp: new Date().toISOString(),
      level: "info",
      source: "unknown",
      message: line
    };
  };





  useEffect(() => {
    if (status !== "connected") return;

    // Send subscription command
    send({ type: "logs_subscribe" });

    const unsubscribe = subscribe("log", (data) => {
      if (isPaused) return;
      if (data.logEntry) {
        setLogs(prev => {
          const newLogs = [...prev, data.logEntry];
          // Keep last 2000 logs
          return newLogs.slice(-2000);
        });
      }
    });

    return () => {
      send({ type: "logs_unsubscribe" });
      unsubscribe();
    };
  }, [status, subscribe, send, isPaused]);

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [logs, autoScroll]);

  const toggleLevel = (level: string) => {
    setFilterLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesLevel = filterLevels.includes(log.level);
      const matchesSearch = log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.meta && JSON.stringify(log.meta).toLowerCase().includes(searchTerm.toLowerCase()));
      return matchesLevel && matchesSearch;
    });
  }, [logs, filterLevels, searchTerm]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case "error": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "warn": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "debug": return "bg-slate-500/10 text-slate-500 border-slate-500/20";
      default: return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] space-y-4 mt-10">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Logs del Sistema</h2>
          <p className="text-muted-foreground">Monitoreo en tiempo real de la actividad del enjambre.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            className={isPaused ? "text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10" : ""}
          >
            {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
            {isPaused ? "Renaudar" : "Pausar"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLogs([])}>
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar
          </Button>
          <Button variant="outline" size="sm" onClick={() => { }} disabled={true} className="opacity-50">
            <RefreshCw className="h-4 w-4 mr-2" />
            Sincronizado via WS
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <Card className="bg-muted/30">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar en logs..."
              className="pl-9 h-9 bg-background"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-background rounded-md border text-xs">
            {(["debug", "info", "warn", "error"] as const).map(lvl => (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                className={cn(
                  "px-2 py-1 rounded capitalize transition-colors",
                  filterLevels.includes(lvl)
                    ? getLevelColor(lvl).split(" ")[1] + " " + getLevelColor(lvl).split(" ")[0]
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {lvl}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="sr-only"
              checked={autoScroll}
              onChange={() => setAutoScroll(!autoScroll)}
            />
            <div
              className={cn(
                "w-8 h-4 rounded-full relative transition-colors",
                autoScroll ? "bg-primary" : "bg-muted border shadow-inner"
              )}
            >
              <div className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
                autoScroll ? "left-[17px]" : "left-0.5"
              )} />
            </div>
            Auto-scroll
          </label>

          <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", status === "connected" ? "bg-green-500 animate-pulse" : "bg-red-500")} />
            {status === "connected" ? "STREAMING" : "OFFLINE"}
            <span className="mx-1 opacity-30">|</span>
            {filteredLogs.length} de {logs.length} entradas
          </div>
        </CardContent>
      </Card>

      {/* Logs Terminal */}
      <Card className="flex-1 overflow-hidden border-2">
        <CardContent className="p-0 h-full bg-black/95">
          <ScrollArea className="h-full w-full" ref={scrollRef}>
            <div className="p-4 font-mono text-[11px] leading-relaxed">
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground opacity-50">
                  <Activity className="h-10 w-10 mb-4 stroke-[1]" />
                  <p>{loading ? "Analizando registros..." : "No se encontraron logs con los filtros activos."}</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredLogs.map((log) => (
                    <div key={`${log.timestamp}-${log.source}-${log.message.slice(0, 30)}`} className="group flex items-start gap-3 py-0.5 hover:bg-white/5 rounded px-1 transition-colors">
                      <span className="text-slate-600 shrink-0 select-none hidden md:inline">
                        {log.timestamp.includes("T") ? log.timestamp.split("T")[1].split(".")[0] : log.timestamp}
                      </span>
                      <Badge variant="outline" className={cn("px-1 py-0 h-4 text-[9px] uppercase font-bold shrink-0 border", getLevelColor(log.level))}>
                        {log.level}
                      </Badge>
                      <div className="flex-1 break-all text-slate-300">
                        <span className="text-slate-500 mr-2">[{log.source}]</span>
                        {log.message}
                        {log.meta && (
                          <span className="text-slate-500 ml-2 italic opacity-60">
                            {JSON.stringify(log.meta)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="h-4" /> {/* Bottom padding for auto-scroll */}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
