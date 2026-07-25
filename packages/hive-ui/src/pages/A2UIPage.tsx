import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Layers, User as UserIcon, Wifi, WifiOff } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { A2UISurfacePanel } from "@/modules/canvas/a2ui/A2UISurfacePanel";

export function A2UIPage() {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();
  const { currentUser } = useUserStore();
  const isConnected = useCanvasStore((s) => s.isConnected);
  const markA2UISeen = useCanvasStore((s) => s.markA2UISeen);

  const sessionId = (paramSessionId && paramSessionId !== "default") ? paramSessionId : currentUser?.id;

  useEffect(() => {
    markA2UISeen();
  }, [markA2UISeen]);

  if (!sessionId) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background/50 backdrop-blur-sm">
      <div className="flex-1 overflow-hidden p-4 lg:p-8">
        <div className="mx-auto h-full max-w-7xl">
          <div className="hive-card flex h-full flex-col shadow-2xl">
            <div className="flex flex-row items-center justify-between space-y-0 border-b border-white/5 bg-white/5 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="hive-icon-wrap hive-icon-wrap--primary">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="hive-title-page !text-lg">Panel interactivo</h2>
                  <div className="flex items-center gap-2 text-xs text-white/40 mt-0.5">
                    <UserIcon className="h-3 w-3" />
                    <span className="font-mono">{sessionId}</span>
                  </div>
                </div>
              </div>

              <Badge
                variant="outline"
                className={`flex items-center gap-1.5 px-3 py-1 transition-all duration-500 border ${
                  isConnected
                    ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                    : "bg-red-500/15 text-red-500 border-red-500/20 hover:bg-red-500/20"
                }`}
              >
                {isConnected ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 animate-pulse" />
                    <span className="font-semibold uppercase tracking-wider text-[10px]">Live</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5" />
                    <span className="font-semibold uppercase tracking-wider text-[10px]">Offline</span>
                  </>
                )}
              </Badge>
            </div>

            <A2UISurfacePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
