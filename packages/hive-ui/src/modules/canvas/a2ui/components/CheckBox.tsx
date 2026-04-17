import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString, resolveDynamicBoolean } from "../dataBinding";

export function A2UICheckBox({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const label = resolveDynamicString(def.label, ctx.dataModel, ctx.scopeData);
  const checkedFromModel = resolveDynamicBoolean(def.value as any, ctx.dataModel, ctx.scopeData);
  const [localChecked, setLocalChecked] = useState(checkedFromModel);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalChecked(e.target.checked);
    if (typeof def.value === "object" && def.value !== null && "path" in (def.value as any)) {
      const path = (def.value as any).path as string;
      ctx.setDataModel((prev) => {
        const next = structuredClone(prev);
        const parts = path.replace(/^\//, "").split("/");
        let cur: any = next;
        for (let i = 0; i < parts.length - 1; i++) {
          if (cur[parts[i]] == null) cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = e.target.checked;
        return next;
      });
    }
  };

  return (
    <label className="flex items-center gap-2.5 cursor-pointer" style={def.weight ? { flex: def.weight } : undefined}>
      <input
        type="checkbox"
        checked={localChecked}
        onChange={handleChange}
        className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/30"
      />
      <span className="text-sm text-white/70">{label}</span>
    </label>
  );
}