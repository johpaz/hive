import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";

const VARIANT_MAP: Record<string, string> = {
  h1: "text-2xl font-black text-white",
  h2: "text-xl font-bold text-white",
  h3: "text-base font-bold text-white",
  h4: "text-sm font-semibold text-white/90",
  h5: "text-xs font-semibold text-white/80",
  body: "text-sm text-white/70 leading-relaxed",
  caption: "text-xs text-white/40",
  label: "text-xs font-semibold text-white/50 uppercase tracking-wider",
  code: "font-mono text-xs text-green-300 bg-black/40 rounded-lg p-3 leading-relaxed whitespace-pre-wrap break-all",
};

export function A2UIText({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const text = resolveDynamicString(def.text, ctx.dataModel, ctx.scopeData);
  const variant: string = def.usageHint ?? "body";
  const className = VARIANT_MAP[variant] ?? VARIANT_MAP.body;

  // Simple markdown: **bold**, *italic*, `code`, \n
  if (variant === "code") {
    return <pre className={className}>{text}</pre>;
  }

  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\n)/g);
  return (
    <p className={className} style={def.weight ? { flex: def.weight } : undefined}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="font-mono text-green-300 bg-black/30 px-1 rounded text-[0.9em]">{part.slice(1, -1)}</code>;
        if (part === "\n") return <br key={i} />;
        return part;
      })}
    </p>
  );
}