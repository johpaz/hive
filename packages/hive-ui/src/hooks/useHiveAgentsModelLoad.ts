import { useCallback, useRef } from "react";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";

const HIVEAGENTS_POLL_INTERVAL_MS = 2500;
const HIVEAGENTS_LOAD_TIMEOUT_MS = 300000;

/**
 * Shared state machine for mounting a HiveAgents (local llama.cpp) model: triggers
 * POST /api/load with the model's real context_window, then polls status until the
 * backend reports it loaded (or the timeout is hit). `contextWindow` must come from
 * the model's own DB record — never a hardcoded fallback, that's exactly the bug
 * this hook exists to not repeat.
 */
export function useHiveAgentsModelLoad() {
  const loadHiveAgentsModel = useGlobalConfigStore((state) => state.loadHiveAgentsModel);
  const getHiveAgentsModelStatus = useGlobalConfigStore((state) => state.getHiveAgentsModelStatus);
  const abortRef = useRef<{ abort: boolean } | null>(null);

  const load = useCallback(async (modelId: string, contextWindow: number): Promise<boolean> => {
    // A previous load may still be polling in the background (e.g. the user picked
    // another model before the first one confirmed). Abort it so only the most
    // recent selection can ever resolve `true` and reach onModelChange.
    if (abortRef.current) abortRef.current.abort = true;

    const myAbortRef = { abort: false };
    abortRef.current = myAbortRef;
    const start = Date.now();

    try {
      await loadHiveAgentsModel(modelId, contextWindow);
    } catch {
      return false;
    }

    while (!myAbortRef.abort && Date.now() - start < HIVEAGENTS_LOAD_TIMEOUT_MS) {
      try {
        const status = await getHiveAgentsModelStatus();
        if (status.loaded && status.model?.name === modelId) {
          return true;
        }
      } catch {
        // ignore polling errors
      }
      await new Promise((resolve) => setTimeout(resolve, HIVEAGENTS_POLL_INTERVAL_MS));
    }

    return false;
  }, [loadHiveAgentsModel, getHiveAgentsModelStatus]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort = true;
      abortRef.current = null;
    }
  }, []);

  return { load, cancel };
}
