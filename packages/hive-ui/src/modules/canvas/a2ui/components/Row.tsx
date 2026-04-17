import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { renderChildren } from "../A2UIRenderer";

const JUSTIFY_MAP: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
};

export function A2UIRow({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const justify = JUSTIFY_MAP[def.distribution ?? "start"] ?? "flex-start";
  const align = def.alignment === "center" ? "center" : def.alignment === "end" ? "flex-end" : def.alignment === "stretch" ? "stretch" : "flex-start";

  return (
    <div
      className="flex flex-row gap-2"
      style={{
        justifyContent: justify,
        alignItems: align,
        ...(def.weight ? { flex: def.weight } : {}),
      }}
    >
      {renderChildren(def.children, ctx)}
    </div>
  );
}