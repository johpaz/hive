import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";

export function A2UIDateTimeInput({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const [localValue, setLocalValue] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
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
        cur[parts[parts.length - 1]] = e.target.value;
        return next;
      });
    }
  };

  const inputType = def.enableTime && def.enableDate ? "datetime-local" : def.enableDate ? "date" : "time";

  return (
    <div className="space-y-1.5" style={def.weight ? { flex: def.weight } : undefined}>
      {def.label && (
        <label className="text-xs font-semibold text-white/45 uppercase tracking-wider">
          {typeof def.label === "string" ? def.label : String(def.label)}
        </label>
      )}
      <input
        type={inputType}
        value={localValue}
        onChange={handleChange}
        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white/[0.04] border-white/[0.08] focus:border-blue-500/50 focus:bg-white/[0.06] outline-none text-white/80"
      />
    </div>
  );
}