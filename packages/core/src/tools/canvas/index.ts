/**
 * Canvas Tools - 7 tools + A2UI v0.9 tools
 *
 * @category canvas
 */

import type { Tool, ToolResult } from "../types.ts";
import { emitCanvas, removeCanvasComponent, type CanvasEventType } from "../../canvas/emitter";
import { logger } from "../../utils/logger.ts";
import { canvasManager } from "../../canvas/canvas-manager.ts";
import { createA2UISurfaceTool, createA2UIUpdateComponentsTool, createA2UIUpdateDataModelTool, createA2UIDeleteSurfaceTool } from "../../canvas/a2ui-tools.ts";
import type { Config } from "../../config/loader.ts";

const log = logger.child("canvas");

// ─── Pending canvas interactions ─────────────────────────────────────────────
// Simple map indexed by componentId — no session ID required.
// Server calls resolveCanvasInteraction() when it receives canvas:interact.

interface PendingInteraction {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingInteractions = new Map<string, PendingInteraction>();

export function resolveCanvasInteraction(componentId: string, data: unknown): boolean {
  const pending = pendingInteractions.get(componentId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingInteractions.delete(componentId);
  pending.resolve(data);
  return true;
}

function waitForCanvasInteraction(componentId: string, timeoutMs = 300000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingInteractions.delete(componentId);
      reject(new Error(`Interaction timeout for ${componentId}`));
    }, timeoutMs);
    pendingInteractions.set(componentId, { resolve, reject, timeout });
  });
}

// ─── canvas_render ───────────────────────────────────────────────────────────

export const canvasRenderTool: Tool = {
  name: "canvas_render",
  description: "Render a component or visualization on the canvas. Use specific types instead of always using card+markdown. Key types: chart (bar/line/area/pie graphs), table (tabular data), markdown (rich text), form (interactive form - waits for submit), button (interactive button), alert-dialog (confirm/cancel dialog), progress (progress bars), accordion, tabs, badge, card, bee-loader. Spanish: renderizar, visualizar, gráfico, diagrama, tabla, formulario",
  parameters: {
    type: "object",
    properties: {
      component: { type: "string", description: "Component type. Visualization: chart, table, markdown, card, progress, accordion, tabs, badge, separator, bee-loader. Interactive: form, button, alert-dialog. Layout: carousel, collapsible, resizable, scroll-area, tabs. Other: alert, avatar, breadcrumb, calendar, checkbox, dialog, drawer, dropdown-menu, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, radio-group, select, sheet, skeleton, slider, switch, textarea, toggle, toggle-group, tooltip, aspect-ratio, command, context-menu, custom" },
      data: { type: "object", description: "Props for the component. chart: {type:'bar'|'line'|'area'|'pie', data:[{name,...}], xKey:'name', keys:['value'], title}. table: {title, columns:[{header,key}], data:[{}]}. form: {title, fields:[{name,label,type:'text'|'email'|'number'|'textarea'|'select'|'checkbox',placeholder,options:[{value,label}]}], submitLabel}. alert-dialog: {title, description, confirmLabel, cancelLabel}. button: {label, variant:'default'|'outline'|'secondary'|'destructive'}. markdown: {content}. progress: {value:0-100}." },
    },
    required: ["component", "data"],
  },
  execute: async (params: Record<string, unknown>) => {
    const componentType = params.component as string;
    const data = params.data as Record<string, unknown>;

    try {
      const id = `render_${componentType}_${Date.now()}`;
      emitCanvas("canvas:render", {
        component: {
          id,
          type: componentType,
          props: data ?? {},
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          agentId: "agent",
        },
      });
      return { ok: true, message: `Rendered ${componentType}.` };
    } catch (error) {
      return { ok: false, error: `Failed to render: ${(error as Error).message }` };
    }
  },
};

// ─── canvas_ask ──────────────────────────────────────────────────────────────

export const canvasAskTool: Tool = {
  name: "canvas_ask",
  description: "Show interactive form and wait for user input. Spanish: formulario interactivo, preguntar usuario, input",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "List of questions to ask",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            type: { type: "string", enum: ["text", "select", "confirm"] },
            options: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    required: ["questions"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const questions = params.questions as any[];
    const userId = config?.configurable?.user_id;
    const threadId = config?.configurable?.thread_id;
    // Use threadId (session) if available, then userId, then default
    // This must match the WebSocket sessionId used by the frontend
    const sessionId = threadId ? `canvas:${threadId}` : userId ? `canvas:${userId}` : "canvas:default";

    // Convert questions to form fields
    const fields = questions.map((q, idx) => ({
      name: `field_${idx}`,
      label: q.question,
      type: q.type === "select" ? "select" : q.type === "confirm" ? "text" : "text",
      required: true,
      options: q.options?.map((opt: string) => ({ label: opt, value: opt })),
    }));

    const formId = `form-${Date.now()}`;

    try {
      // Render form via canvasManager
      await canvasManager.render(sessionId, {
        id: formId,
        type: "form",
        props: {
          title: "Input Required",
          fields,
        },
      });

      // Wait for user interaction
      const response = await canvasManager.waitForInteraction(sessionId, formId, 300000);

      return {
        ok: true,
        message: "Form submitted by user",
        data: response,
        formId,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Form interaction failed: ${(error as Error).message}`,
        formId,
      };
    }
  },
};

// ─── canvas_confirm ──────────────────────────────────────────────────────────

export const canvasConfirmTool: Tool = {
  name: "canvas_confirm",
  description: "Show a confirmation dialog before executing an action. Spanish: confirmar acción, diálogo, aprobar",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Confirmation message" },
      action: { type: "string", description: "Action to confirm" },
    },
    required: ["message", "action"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const message = params.message as string;
    const action = params.action as string;

    const confirmId = `confirm-${Date.now()}`;

    emitCanvas("canvas:render", {
      component: {
        id: confirmId,
        type: "alert-dialog",
        props: { title: action, description: message, confirmLabel: "Confirmar", cancelLabel: "Cancelar" },
        position: { x: 0, y: 0 },
        size: { width: 400, height: 200 },
        agentId: "agent",
      },
    });

    try {
      const interactionData = await waitForCanvasInteraction(confirmId, 300000) as any;
      removeCanvasComponent(confirmId);
      const confirmed = interactionData?.confirmed === true;
      return { ok: true, confirmed, action, message };
    } catch (error) {
      removeCanvasComponent(confirmId);
      return { ok: false, confirmed: false, error: (error as Error).message };
    }
  },
};

// ─── canvas_show_card ────────────────────────────────────────────────────────

export const canvasShowCardTool: Tool = {
  name: "canvas_show_card",
  description: "Display structured information in card format. Spanish: mostrar tarjeta, card, información estructurada",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Card title" },
      content: { type: "string", description: "Card content (Markdown supported)" },
      items: {
        type: "array",
        description: "List of key-value items",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
        },
      },
    },
    required: ["title"],
  },
  execute: async (params: Record<string, unknown>) => {
    const title = params.title as string;
    const content = params.content as string | undefined;
    const items = (params.items as Array<{ label: string; value: string }>) || [];

    try {
      const id = `card_${Date.now()}`;
      emitCanvas("canvas:render", {
        component: {
          id,
          type: "card",
          props: {
            title,
            children: content ?? (items.length > 0 ? items.map((item) => `**${item.label}:** ${item.value}`).join("\n") : ""),
            // Pass items as table rows for richer rendering
            items,
          },
          position: { x: 0, y: 0 },
          size: { width: 320, height: 200 },
          agentId: "agent",
        },
      });
      return { ok: true, message: `Card "${title}" displayed.` };
    } catch (error) {
      return { ok: false, error: `Failed to display card: ${(error as Error).message }` };
    }
  },
};

// ─── canvas_show_progress ────────────────────────────────────────────────────

export const canvasShowProgressTool: Tool = {
  name: "canvas_show_progress",
  description: "Show progress bar or status indicator. Spanish: barra de progreso, indicador, progreso visual",
  parameters: {
    type: "object",
    properties: {
      bars: {
        type: "array",
        description: "List of progress bars",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "number", minimum: 0, maximum: 100 },
          },
        },
      },
    },
    required: ["bars"],
  },
  execute: async (params: Record<string, unknown>) => {
    const bars = params.bars as Array<{ label: string; value: number }>;

    try {
      // Render each bar as a separate progress component
      for (const bar of bars) {
        const id = `progress_${bar.label.replace(/\s+/g, "_")}_${Date.now()}`;
        emitCanvas("canvas:render", {
          component: {
            id,
            type: "progress",
            props: { value: bar.value, label: bar.label },
            position: { x: 0, y: 0 },
            size: { width: 320, height: 60 },
            agentId: "agent",
          },
        });
      }
      return { ok: true, message: "Progress displayed." };
    } catch (error) {
      return { ok: false, error: `Failed to display progress: ${(error as Error).message }` };
    }
  },
};

// ─── canvas_show_list ────────────────────────────────────────────────────────

export const canvasShowListTool: Tool = {
  name: "canvas_show_list",
  description: "Display key-value list information. Spanish: lista clave-valor, mostrar lista, información en lista",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "List title" },
      items: {
        type: "object",
        description: "Key-value pairs",
        additionalProperties: { type: "string" },
      },
    },
    required: ["title", "items"],
  },
  execute: async (params: Record<string, unknown>) => {
    const title = params.title as string;
    const items = params.items as Record<string, string>;

    try {
      const id = `list_${Date.now()}`;
      // Render as a table with key/value columns
      const columns = [{ header: "Campo", key: "key" }, { header: "Valor", key: "value" }];
      const data = Object.entries(items).map(([key, value]) => ({ key, value }));

      emitCanvas("canvas:render", {
        component: {
          id,
          type: "table",
          props: { title, columns, data },
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          agentId: "agent",
        },
      });
      return { ok: true, message: `List "${title}" displayed.` };
    } catch (error) {
      return { ok: false, error: `Failed to display list: ${(error as Error).message }` };
    }
  },
};

// ─── canvas_clear ────────────────────────────────────────────────────────────

export const canvasClearTool: Tool = {
  name: "canvas_clear",
  description: "Clear current canvas content. Spanish: limpiar canvas, borrar visualización, resetear",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    try {
      emitCanvas("canvas:clear", {});
      return { ok: true, message: "Canvas cleared." };
    } catch (error) {
      return { ok: false, error: `Failed to clear canvas: ${(error as Error).message }` };
    }
  },
};

export function createTools(config?: Config): Tool[] {
  const a2uiConfig = config ?? {} as Config;
  return [
    canvasRenderTool,
    canvasAskTool,
    canvasConfirmTool,
    canvasShowCardTool,
    canvasShowProgressTool,
    canvasShowListTool,
    canvasClearTool,
    createA2UISurfaceTool(a2uiConfig),
    createA2UIUpdateComponentsTool(a2uiConfig),
    createA2UIUpdateDataModelTool(a2uiConfig),
    createA2UIDeleteSurfaceTool(a2uiConfig),
  ];
}
