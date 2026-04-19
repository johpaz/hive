import { useState, useMemo, useCallback, useEffect } from "react";
import type {
  A2UISurface,
  ComponentDef,
  A2UIActionMessage,
  A2UITheme,
  ChildListExplicit,
  ChildListArray,
  ChildListTemplate,
  ChildListTemplateLegacy,
} from "@/types/a2ui";
import {
  resolveDynamicString,
  resolveDynamicNumber,
  resolveDynamicBoolean,
  resolveDynamicStringList,
  resolvePath,
  formatString,
  updateDataModel,
  isPath,
  isFunctionCall,
} from "./dataBinding";
import { runChecks, checkButtonDisabled } from "./functions";
import { A2UIText } from "./components/Text";
import { A2UIButton } from "./components/Button";
import { A2UIRow } from "./components/Row";
import { A2UIColumn } from "./components/Column";
import { A2UICard } from "./components/Card";
import { A2UIList } from "./components/List";
import { A2UIDivider } from "./components/Divider";
import { A2UIImage } from "./components/Image";
import { A2UIIcon } from "./components/Icon";
import { A2UITextField } from "./components/TextField";
import { A2UICheckBox } from "./components/CheckBox";
import { A2UIChoicePicker } from "./components/ChoicePicker";
import { A2UISlider } from "./components/Slider";
import { A2UIDateTimeInput } from "./components/DateTimeInput";
import { A2UITabs } from "./components/Tabs";
import { A2UIModal } from "./components/Modal";
import { A2UIVideo } from "./components/Video";
import { A2UIAudioPlayer } from "./components/AudioPlayer";

export interface A2UIRendererProps {
  surface: A2UISurface;
  onAction?: (action: A2UIActionMessage) => void;
  isLoading?: boolean;
}

export function A2UIRenderer({ surface, onAction, isLoading }: A2UIRendererProps) {
  const { components, dataModel, rootId, theme } = surface;

  // Local state for two-way binding (input values before action)
  const [localDataModel, setLocalDataModel] = useState<Record<string, unknown>>(() =>
    structuredClone(dataModel)
  );

  // Sync local data model when server updates come in
  useEffect(() => {
    setLocalDataModel(structuredClone(dataModel));
  }, [dataModel]);

  // Build component map from ordered list
  const compMap = useMemo(() => {
    const map = new Map<string, ComponentDef>();
    for (const comp of components) {
      map.set(comp.id, comp);
    }
    return map;
  }, [components]);

  const primaryColor = theme?.primaryColor || "#3B82F6";

  const handleAction = useCallback(
    (actionName: string, context: Record<string, unknown>, sourceComponentId: string) => {
      if (!onAction) return;
      const action: A2UIActionMessage = {
        name: actionName,
        surfaceId: surface.surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      };
      onAction(action);
    },
    [onAction, surface.surfaceId]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-white/30 text-sm animate-pulse">Cargando superficie...</span>
      </div>
    );
  }

  if (!rootId || !compMap.has(rootId)) {
    return (
      <div className="flex items-center justify-center py-8 text-white/20 text-sm">
        Sin contenido disponible
      </div>
    );
  }

  return (
    <div
      className="a2ui-surface"
      style={{ "--a2ui-primary": primaryColor } as React.CSSProperties}
    >
      <RenderComponent
        id={rootId}
        compMap={compMap}
        dataModel={localDataModel}
        setDataModel={setLocalDataModel}
        scopeData={undefined}
        onAction={handleAction}
      />
    </div>
  );
}

// ─── Render Context ─────────────────────────────────────────────────────────

interface RenderCtx {
  id: string;
  compMap: Map<string, ComponentDef>;
  dataModel: Record<string, unknown>;
  setDataModel: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  scopeData?: Record<string, unknown>;
  onAction: (name: string, context: Record<string, unknown>, sourceId: string) => void;
}

// ─── Component Dispatcher ───────────────────────────────────────────────────

function RenderComponent(ctx: RenderCtx): React.ReactNode {
  const def = ctx.compMap.get(ctx.id);
  if (!def) return null;

  // Normalize type: strip non-ASCII chars (e.g. Gemini appends "项"), trim whitespace
  const type = def.component?.replace(/[^\x00-\x7F]/g, "").trim();

  // Dispatch to component renderers
  switch (type) {
    case "Text": return <A2UIText def={def} ctx={ctx} />;
    case "Button": return <A2UIButton def={def} ctx={ctx} />;
    case "Row": return <A2UIRow def={def} ctx={ctx} />;
    case "Column": return <A2UIColumn def={def} ctx={ctx} />;
    case "Card": return <A2UICard def={def} ctx={ctx} />;
    case "List": return <A2UIList def={def} ctx={ctx} />;
    case "Divider": return <A2UIDivider def={def} ctx={ctx} />;
    case "Image": return <A2UIImage def={def} ctx={ctx} />;
    case "Icon": return <A2UIIcon def={def} ctx={ctx} />;
    case "TextField": return <A2UITextField def={def} ctx={ctx} />;
    case "CheckBox": return <A2UICheckBox def={def} ctx={ctx} />;
    case "ChoicePicker": return <A2UIChoicePicker def={def} ctx={ctx} />;
    case "Slider": return <A2UISlider def={def} ctx={ctx} />;
    case "DateTimeInput": return <A2UIDateTimeInput def={def} ctx={ctx} />;
    case "Tabs": return <A2UITabs def={def} ctx={ctx} />;
    case "Modal": return <A2UIModal def={def} ctx={ctx} />;
    case "Video": return <A2UIVideo def={def} ctx={ctx} />;
    case "AudioPlayer": return <A2UIAudioPlayer def={def} ctx={ctx} />;
    default:
      // Unknown component type — render as a subtle placeholder
      return (
        <div className="rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/30">
          Unknown component: {type}
        </div>
      );
  }
}

// ─── Render children helper ─────────────────────────────────────────────────

export function renderChildren(
  children: ComponentDef["children"],
  ctx: RenderCtx
): React.ReactNode[] {
  if (!children) return [];

  // String child (single reference)
  if (typeof children === "string") {
    return [<RenderComponent key={children} {...ctx} id={children} weight={ctx.compMap.get(children)?.weight} />];
  }

  // spec oficial: raw array ["id1", "id2"]
  if (Array.isArray(children)) {
    return (children as string[]).map((childId) => (
      <RenderComponent key={childId} {...ctx} id={childId} weight={ctx.compMap.get(childId)?.weight} />
    ));
  }

  // wrapper objects: { explicitList } | { array } (aliases no-spec aceptados)
  if ("explicitList" in children || "array" in children) {
    const arr = "explicitList" in children
      ? (children as ChildListExplicit).explicitList
      : (children as ChildListArray).array;
    return arr.map((childId) => (
      <RenderComponent key={childId} {...ctx} id={childId} weight={ctx.compMap.get(childId)?.weight} />
    ));
  }

  // spec oficial: template { path, componentId }
  if ("path" in children && "componentId" in children) {
    const tmpl = children as ChildListTemplateLegacy;
    const data = resolvePath(tmpl.path, ctx.dataModel, ctx.scopeData);
    if (!Array.isArray(data)) return [];
    return data.map((item, index) => {
      const scopeData = typeof item === "object" && item !== null ? item as Record<string, unknown> : { value: item, index };
      return (
        <RenderComponent
          key={`${tmpl.componentId}_${index}`}
          {...ctx}
          id={tmpl.componentId}
          scopeData={scopeData}
        />
      );
    });
  }

  // alias no-spec: { template: { dataBinding, componentId } }
  if ("template" in children) {
    const tmpl = (children as ChildListTemplate).template;
    const data = resolvePath(tmpl.dataBinding, ctx.dataModel, ctx.scopeData);
    if (!Array.isArray(data)) return [];
    return data.map((item, index) => {
      const scopeData = typeof item === "object" && item !== null ? item as Record<string, unknown> : { value: item, index };
      return (
        <RenderComponent
          key={`${tmpl.componentId}_${index}`}
          {...ctx}
          id={tmpl.componentId}
          scopeData={scopeData}
        />
      );
    });
  }

  return [];
}

export { RenderComponent };