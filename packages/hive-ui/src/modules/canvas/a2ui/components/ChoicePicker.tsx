import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString, resolveDynamicStringList } from "../dataBinding";

export function A2UIChoicePicker({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const variant = def.variant === "mutuallyExclusive" ? "single" : "multi";
  const maxSel = def.maxAllowedSelections ?? (variant === "single" ? 1 : 5);
  const currentSelections = resolveDynamicStringList(def.selections as any, ctx.dataModel, ctx.scopeData);
  const [localSelections, setLocalSelections] = useState<string[]>(currentSelections);
  const options = def.options ?? [];

  const toggle = (value: string) => {
    setLocalSelections((prev) => {
      let next: string[];
      if (variant === "single") {
        next = [value];
      } else {
        if (prev.includes(value)) {
          next = prev.filter((v) => v !== value);
        } else if (prev.length >= maxSel) {
          next = prev;
        } else {
          next = [...prev, value];
        }
      }

      // Two-way binding
      if (typeof def.selections === "object" && def.selections !== null && "path" in (def.selections as any)) {
        const path = (def.selections as any).path as string;
        ctx.setDataModel((prevModel) => {
          const nextModel = structuredClone(prevModel);
          const parts = path.replace(/^\//, "").split("/");
          let cur: any = nextModel;
          for (let i = 0; i < parts.length - 1; i++) {
            if (cur[parts[i]] == null) cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = next;
          return nextModel;
        });
      }

      return next;
    });
  };

  return (
    <div className="space-y-2" style={def.weight ? { flex: def.weight } : undefined}>
      {options.map((opt, i) => {
        const label = resolveDynamicString(opt.label, ctx.dataModel, ctx.scopeData);
        const value = opt.value ?? label;
        const isSelected = localSelections.includes(value);
        const letterLabel = String.fromCharCode(65 + i);

        return (
          <button
            key={i}
            type="button"
            onClick={() => toggle(value)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all flex items-center gap-2.5
              ${isSelected
                ? "bg-blue-500/15 border-blue-500/50 text-blue-100"
                : "bg-white/[0.03] border-white/[0.08] text-white/65 hover:border-white/20 hover:bg-white/[0.06]"
              }`}
          >
            <span className={`text-xs font-bold w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors
              ${isSelected ? "bg-blue-500/40 text-blue-200" : "bg-white/5 text-white/40"}`}>
              {isSelected ? "✓" : letterLabel}
            </span>
            <span className="leading-snug">{label}</span>
          </button>
        );
      })}
    </div>
  );
}