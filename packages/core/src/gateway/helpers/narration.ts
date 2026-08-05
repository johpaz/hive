// The tool narration map lives in the narration domain (`events/`) so the agent
// loop can label its own events without depending on the gateway. Re-exported
// here to keep the existing `gateway/helpers` import path working.
export { getNarration } from "../../events/tool-narration.ts";
