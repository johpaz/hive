import { useEffect } from "react";
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
  const graphEdges = useCanvasStore((s) => s.graphEdges);
  const workEvents = useCanvasStore((s) => s.workEvents);
  const isConnected = useCanvasStore((s) => s.isConnected);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const { coordinator, desks, interactions } = useOfficeModel(agents, graphNodes, graphEdges);

  return { coordinator, desks, interactions, workEvents, isConnected };
}
