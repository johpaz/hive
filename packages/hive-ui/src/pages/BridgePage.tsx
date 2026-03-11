import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BridgeStatus } from "@/modules/bridge/BridgeStatus";
import { BridgeProcessList } from "@/modules/bridge/BridgeProcessList";
import { BridgeLogViewer } from "@/modules/bridge/BridgeLogViewer";
import { useBridgeStore } from "@/stores/bridgeStore";
import { RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BridgePage() {
  const { isConnected, connect, connectGateway, processes, logs } = useBridgeStore();

  useEffect(() => {
    connect();
    connectGateway();
  }, [connect, connectGateway]);

  const status: "connected" | "connecting" | "disconnected" | "error" = isConnected
    ? "connected"
    : "disconnected";

  const runningCount = processes.filter((p) => p.status === "running").length;

  return (
    <div className="hive-page mt-10">
      <div className="hive-page-container">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Code Bridge
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Monitoreo de comandos CLI y procesos del agente
            </p>
          </div>
          <div className="flex items-center gap-3">
            {runningCount > 0 && (
              <span className="text-xs text-yellow-400 font-mono">
                {runningCount} proceso{runningCount > 1 ? "s" : ""} activo{runningCount > 1 ? "s" : ""}
              </span>
            )}
            <BridgeStatus status={status} />
            <Button variant="outline" size="sm" onClick={() => { connect(); connectGateway(); }}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reconectar
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-14rem)]">
          {/* Processes */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Procesos</span>
                <span className="text-xs text-muted-foreground font-normal">{processes.length} total</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-2">
              <BridgeProcessList />
            </CardContent>
          </Card>

          {/* Logs */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Logs</span>
                <span className="text-xs text-muted-foreground font-normal">{logs.length} entradas</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <BridgeLogViewer />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
