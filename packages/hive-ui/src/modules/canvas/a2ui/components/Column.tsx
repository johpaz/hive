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

export function A2UIColumn({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  // spec: "justify"/"align" | ours: "distribution"/"alignment" (aliases)
  const justify = JUSTIFY_MAP[(def.justify ?? def.distribution) ?? "start"] ?? "flex-start";
  const align = (() => { const a = def.align ?? def.alignment; return a === "center" ? "center" : a === "end" ? "flex-end" : a === "stretch" ? "stretch" : "flex-start"; })();

  return (
    <div
      className="flex flex-col gap-3"
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