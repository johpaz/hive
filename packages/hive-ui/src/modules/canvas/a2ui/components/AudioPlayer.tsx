import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";

export function A2UIAudioPlayer({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const url = resolveDynamicString(def.url as any, ctx.dataModel, ctx.scopeData);
  const description = resolveDynamicString(def.description as any, ctx.dataModel, ctx.scopeData);

  if (!url) return null;

  return (
    <div className="rounded-xl border border-white/[0.08] p-4 bg-white/[0.02]" style={def.weight ? { flex: def.weight } : undefined}>
      {description && <p className="text-xs text-white/40 mb-2">{description}</p>}
      <audio src={url} controls className="w-full" style={{ height: 40 }}>
        Tu navegador no soporta audio.
      </audio>
    </div>
  );
}