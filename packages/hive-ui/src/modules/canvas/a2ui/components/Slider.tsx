import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicNumber } from "../dataBinding";
import { Slider } from "@/components/ui/slider";

export function A2UISlider({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  // spec: "min"/"max" | ours: "minValue"/"maxValue" (aliases)
  const min = def.min ?? def.minValue ?? 0;
  const max = def.max ?? def.maxValue ?? 100;
  const label = def.label as string | undefined;
  const initialValue = resolveDynamicNumber(def.value as any, ctx.dataModel, ctx.scopeData);
  const [localValue, setLocalValue] = useState(initialValue);

  const updateModel = (v: number) => {
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

  const handleChange = (val: number[]) => {
    setLocalValue(val[0]);
    updateModel(val[0]);
  };

  const handleCommit = (val: number[]) => {
    const v = val[0];
    const action = def.action as any;
    const event = action?.event ?? action;
    const eventName = event?.name as string | undefined;
    if (eventName) {
      ctx.onAction(eventName, { value: v }, def.id);
    }
  };

  return (
    <div className="space-y-2" style={def.weight ? { flex: def.weight } : undefined}>
      {label && <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">{label}</span>}
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
        onValueCommit={handleCommit}
        className="w-full"
      />
    </div>
  );
}