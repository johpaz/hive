import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicNumber } from "../dataBinding";
import { Slider } from "@/components/ui/slider";

export function A2UISlider({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const min = def.minValue ?? 0;
  const max = def.maxValue ?? 100;
  const initialValue = resolveDynamicNumber(def.value as any, ctx.dataModel, ctx.scopeData);
  const [localValue, setLocalValue] = useState(initialValue);

  const handleChange = (val: number[]) => {
    const v = val[0];
    setLocalValue(v);
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
        cur[parts[parts.length - 1]] = v;
        return next;
      });
    }
  };

  return (
    <div className="space-y-2" style={def.weight ? { flex: def.weight } : undefined}>
      <div className="flex justify-between text-xs text-white/40">
        <span>{min}</span>
        <span className="text-white/70 font-mono">{localValue}</span>
        <span>{max}</span>
      </div>
      <Slider
        value={[localValue]}
        min={min}
        max={max}
        step={def.step ?? 1}
        onValueChange={handleChange}
        className="w-full"
      />
    </div>
  );
}