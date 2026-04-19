import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";
import { runChecks } from "../functions";

export function A2UITextField({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const valueFromModel = resolveDynamicString(
    typeof def.value === "object" && def.value !== null ? def.value as any : def.value as any,
    ctx.dataModel,
    ctx.scopeData
  );
  const [localValue, setLocalValue] = useState(valueFromModel);
  const label = resolveDynamicString(def.label, ctx.dataModel, ctx.scopeData);
  const placeholder = resolveDynamicString(def.placeholder, ctx.dataModel, ctx.scopeData);
  // spec: "variant" | ours: "textFieldType" (alias)
  const variant = def.variant ?? def.textFieldType ?? "shortText";
  const isCode = variant === "code" || variant === "multiline_code";
  const isLong = variant === "longText" || isCode || variant === "multiline";

  // Validation: spec uses "validationRegexp", ours uses "checks[]"
  const validation = (() => {
    if (def.checks) return runChecks(def.checks, ctx.dataModel, ctx.scopeData);
    if (def.validationRegexp && localValue) {
      const ok = new RegExp(def.validationRegexp as string).test(localValue as string);
      return ok ? { valid: true, errors: [] } : { valid: false, errors: [{ message: "Formato inválido" }] };
    }
    return { valid: true, errors: [] };
  })();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

  const fireAction = (value: string) => {
    const action = def.action as any;
    const event = action?.event ?? action;
    const eventName = event?.name as string | undefined;
    if (eventName) {
      ctx.onAction(eventName, { value }, def.id);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    fireAction(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !isLong) {
      fireAction((e.target as HTMLInputElement).value);
    }
  };

  const inputClass = `w-full rounded-xl border px-3 py-2.5 text-sm resize-none outline-none transition-all
    bg-white/[0.04] border-white/[0.08] focus:border-blue-500/50 focus:bg-white/[0.06]
    disabled:opacity-50 placeholder:text-white/20
    ${isCode ? "font-mono text-green-300 leading-relaxed" : "text-white/80 leading-relaxed"}
    ${!validation.valid ? "border-red-500/50" : ""}`;

  return (
    <div className="space-y-1.5" style={def.weight ? { flex: def.weight } : undefined}>
      {label && (
        <label className="text-xs font-semibold text-white/45 uppercase tracking-wider">
          {label}
        </label>
      )}
      {isLong ? (
        <textarea
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={isCode ? 5 : 3}
          className={inputClass}
        />
      ) : (
        <input
          type={variant === "obscured" ? "password" : variant === "number" ? "number" : "text"}
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
      {!validation.valid && validation.errors.length > 0 && (
        <p className="text-xs text-red-400">{validation.errors[0].message}</p>
      )}
    </div>
  );
}