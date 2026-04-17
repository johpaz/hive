import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { renderChildren, RenderComponent } from "../A2UIRenderer";

export function A2UIList({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const direction = def.direction === "horizontal" ? "flex-row" : "flex-col";

  if (def.children) {
    return (
      <div className={`flex ${direction} gap-2 overflow-x-auto pb-1`} style={def.weight ? { flex: def.weight } : undefined}>
        {renderChildren(def.children, ctx)}
      </div>
    );
  }

  // Fallback: render child if present
  if (def.child) {
    return <RenderComponent {...ctx} id={def.child} />;
  }

  return null;
}