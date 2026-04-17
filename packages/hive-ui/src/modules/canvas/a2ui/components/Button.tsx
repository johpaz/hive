import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";
import { checkButtonDisabled } from "../functions";
import { RenderComponent } from "../A2UIRenderer";

export function A2UIButton({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const action = def.action;
  const variant = def.variant ?? "primary";
  const disabled = def.disabled === true || checkButtonDisabled(def.checks, ctx.dataModel, ctx.scopeData);

  const variantClass = variant === "primary"
    ? "bg-blue-600 hover:bg-blue-500 text-white font-bold"
    : variant === "borderless"
    ? "text-white/70 hover:text-white hover:bg-white/5"
    : "bg-white/5 hover:bg-white/10 text-white/70 border border-white/10";

  const handleClick = () => {
    if (!action?.event || disabled) return;
    // Resolve context values
    const context: Record<string, unknown> = {};
    if (action.event.context) {
      for (const [key, val] of Object.entries(action.event.context)) {
        if (isPath(val)) {
          context[key] = resolvePath(val.path, ctx.dataModel, ctx.scopeData);
        } else if (isFunctionCall(val)) {
          context[key] = executeFunctionCallSimple(val, ctx.dataModel, ctx.scopeData);
        } else {
          context[key] = val;
        }
      }
    }
    ctx.onAction(action.event.name, context, def.id);
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`w-full py-2.5 rounded-xl text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${variantClass}`}
      style={def.weight ? { flex: def.weight } : undefined}
    >
      {def.child ? (
        <RenderComponent {...ctx} id={def.child} />
      ) : (
        resolveDynamicString(def.text, ctx.dataModel, ctx.scopeData) || "Button"
      )}
    </button>
  );
}

import { isPath, isFunctionCall, resolvePath, executeFunctionCall as executeFunctionCallSimple } from "../dataBinding";