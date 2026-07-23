import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Layout, User as UserIcon, Wifi, WifiOff, Terminal } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSpecialists } from "@/hooks/useSpecialists";
import { LegoOffice } from "./office/LegoOffice";

interface CanvasContainerProps {
  sessionId?: string;
}

export function CanvasContainer({ sessionId: propSessionId }: CanvasContainerProps) {
  const user = useUserStore((s) => s.currentUser);
  const isConnected = useCanvasStore((s) => s.isConnected);
  const graphNodes = useCanvasStore((s) => s.graphNodes);
  const { specialists, fetchSpecialists } = useSpecialists();

  const effectiveSessionId = propSessionId || user?.id || "default";

  useEffect(() => {
    fetchSpecialists();
  }, [fetchSpecialists]);

  const awakeCount = specialists.filter((s) => s.runtime.state === "awake").length;

  return (
    <div className="hive-card flex h-full flex-col shadow-2xl">
      {/* Header */}
      <div className="flex flex-row items-center justify-between space-y-0 border-b border-white/5 bg-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="hive-icon-wrap hive-icon-wrap--primary">
            <Layout className="h-5 w-5" />
          </div>
          <div>
            <h2 className="hive-title-page !text-lg">Oficina</h2>
            <div className="flex items-center gap-2 text-xs text-white/40 mt-0.5">
              <UserIcon className="h-3 w-3" />
              <span className="font-mono">{effectiveSessionId}</span>
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

      {/* Oficina Lego — visualización exclusiva de agentes trabajando */}
      <div className="flex-1 overflow-hidden p-4">
        <LegoOffice specialists={specialists} graphNodes={graphNodes} />
      </div>

      <div className="border-t border-white/5 bg-white/[0.02] px-6 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-white/30" />
          <span className="hive-mono">
            {isConnected
              ? `Sincronizado · ${specialists.length} escritorios · ${awakeCount} despiertos`
              : "Reconectando..."}
          </span>
        </div>
      </div>
    </div>
  );
}
