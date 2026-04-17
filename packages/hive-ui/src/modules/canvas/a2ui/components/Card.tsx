import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { RenderComponent } from "../A2UIRenderer";

export function A2UICard({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.08)",
        ...(def.weight ? { flex: def.weight } : {}),
      }}
    >
      {def.child && <RenderComponent {...ctx} id={def.child} />}
    </div>
  );
}