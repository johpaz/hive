import { useEffect, useMemo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useAgents } from "@/stores/useGlobalConfigStore";
import { useOfficeModel } from "./useOfficeModel";

/**
 * Fuente única de verdad de la oficina 3D: agentes catálogo + grafo en vivo
 * del canvasStore (WebSocket).
 */
export function useLiveOffice() {
  const { agents, fetchAgents } = useAgents();
  const graphNodes = useCanvasStore((s) => s.graphNodes);
  const isConnected = useCanvasStore((s) => s.isConnected);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const catalogAgents = useMemo(() => agents.filter((a) => a.source === "catalog"), [agents]);
  const { coordinator, desks } = useOfficeModel(catalogAgents, graphNodes);

  return { coordinator, desks, isConnected };
}
