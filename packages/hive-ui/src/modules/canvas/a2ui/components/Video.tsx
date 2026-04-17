import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";

export function A2UIVideo({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const url = resolveDynamicString(def.url as any, ctx.dataModel, ctx.scopeData);
  if (!url) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.08]" style={def.weight ? { flex: def.weight } : undefined}>
      <video
        src={url}
        controls
        className="w-full max-h-96"
      >
        Tu navegador no soporta video.
      </video>
    </div>
  );
}