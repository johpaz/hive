import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";

export function A2UIDivider({ def }: { def: ComponentDef; ctx: RenderCtx }) {
  const isVertical = def.axis === "vertical";
  return (
    <div
      className={isVertical ? "w-px bg-white/[0.06] self-stretch" : "h-px bg-white/[0.06] w-full"}
      style={def.weight ? { flex: def.weight } : undefined}
    />
  );
}