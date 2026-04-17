import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";

const FIT_MAP: Record<string, string> = {
  contain: "contain",
  cover: "cover",
  fill: "fill",
  none: "none",
  "scale-down": "scale-down",
};

const HINT_CLASS: Record<string, string> = {
  icon: "w-8 h-8",
  avatar: "w-12 h-12 rounded-full",
  smallFeature: "w-24 h-24",
  mediumFeature: "w-48 h-48",
  largeFeature: "w-64 h-64",
  header: "w-full h-48",
};

export function A2UIImage({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const url = resolveDynamicString(def.url, ctx.dataModel, ctx.scopeData);
  if (!url) return null;

  const fit = (FIT_MAP[def.fit ?? "contain"] ?? "contain") as string;
  const hintClass = HINT_CLASS[def.usageHint ?? ""] ?? "";
  const alt = typeof def.alt === "string" ? def.alt : "";

  return (
    <div className={`rounded-xl overflow-hidden border border-white/[0.08] ${hintClass}`} style={def.weight ? { flex: def.weight } : undefined}>
      <img
        src={url}
        alt={alt}
        className="w-full max-h-64 block"
        style={{ objectFit: fit as "contain" | "cover" | "fill" | "none" | "scale-down" }}
      />
    </div>
  );
}