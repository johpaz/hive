import { useEffect, useRef, useState } from "react";
import type { DeskState } from "./useOfficeModel";

const ACTIVE_STATES = new Set<DeskState>(["thinking", "tool_call"]);
const FLASH_MS = 2200;

/**
 * Many delegations finish in a couple of seconds — the idle state right
 * after "thinking"/"tool_call" is easy to miss entirely. This holds a
 * transient "just finished" flag for a couple seconds after leaving an
 * active state, so the office visibly marks the handoff instead of
 * silently snapping back to idle.
 */
export function useFinishFlash(state: DeskState): boolean {
  const [flashing, setFlashing] = useState(false);
  const prev = useRef(state);

  useEffect(() => {
    if (ACTIVE_STATES.has(prev.current) && state === "idle") {
      setFlashing(true);
      const timer = setTimeout(() => setFlashing(false), FLASH_MS);
      prev.current = state;
      return () => clearTimeout(timer);
    }
    if (ACTIVE_STATES.has(state)) setFlashing(false);
    prev.current = state;
  }, [state]);

  return flashing;
}
