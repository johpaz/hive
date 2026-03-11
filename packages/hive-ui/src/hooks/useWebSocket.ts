import { useCallback, useEffect } from "react";
import { useWebSocketStore } from "@/stores/useWebSocketStore";

export function useWebSocket(urlConfig?: string) {
  const { status, url, connect, disconnect, send, subscribe } = useWebSocketStore();

  useEffect(() => {
    // ...
  }, [connect]);

  return { status, url, connect, disconnect, send, subscribe };
}
