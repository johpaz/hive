import { useBridgeStore } from "@/stores/bridgeStore";
import { useEffect } from "react";

export function useBridge() {
  const processes = useBridgeStore((s) => s.processes);
  const logs = useBridgeStore((s) => s.logs);
  const isConnected = useBridgeStore((s) => s.isConnected);
  const addProcess = useBridgeStore((s) => s.addProcess);
  const removeProcess = useBridgeStore((s) => s.removeProcess);
  const addLog = useBridgeStore((s) => s.addLog);
  const clearLogs = useBridgeStore((s) => s.clearLogs);
  const connect = useBridgeStore((s) => s.connect);
  const connectGateway = useBridgeStore((s) => s.connectGateway);
  const disconnect = useBridgeStore((s) => s.disconnect);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    connectGateway();

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [connect, connectGateway, disconnect]);

  return {
    processes,
    logs,
    isConnected,
    addProcess,
    removeProcess,
    addLog,
    clearLogs,
    connect,
    disconnect,
  };
}
