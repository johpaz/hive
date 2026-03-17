/**
 * Canvas Tools - 7 tools
 *
 * @category canvas
 */

import type { Tool, ToolResult } from "../types.ts";
import { emitCanvas, type CanvasEventType } from "../../canvas/emitter";
import { logger } from "../../utils/logger.ts";

const log = logger.child("canvas");

// ─── canvas_render ───────────────────────────────────────────────────────────

export const canvasRenderTool: Tool = {
  name: "canvas_render",
  description: "Render a component or visualization on the canvas. Spanish: renderizar, visualizar, gráfico, diagrama",
  parameters: {
    type: "object",
    properties: {
      component: { type: "string", description: "Component type to render. Available: alert, alert-dialog, accordion, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, input, input-otp, label, markdown, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, textarea, toggle, toggle-group, tooltip, aspect-ratio, hover-card, bee-loader, custom" },
      data: { type: "object", description: "Data to pass to the component" },
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
  execute: async (params: Record<string, unknown>) => {
    const questions = params.questions as any[];

    try {
      emitCanvas("canvas:ask", { questions });
      return { ok: true, message: "Form displayed. Waiting for user input..." };
    } catch (error) {
      return { ok: false, error: `Failed to display form: ${(error as Error).message }` };
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
  execute: async (params: Record<string, unknown>) => {
    const message = params.message as string;
    const action = params.action as string;

    try {
      emitCanvas("canvas:confirm", { message, action });
      return { ok: true, message: "Confirmation dialog displayed." };
    } catch (error) {
      return { ok: false, error: `Failed to display confirmation: ${(error as Error).message }` };
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

export function createTools(): Tool[] {
  return [
    canvasRenderTool,
    canvasAskTool,
    canvasConfirmTool,
    canvasShowCardTool,
    canvasShowProgressTool,
    canvasShowListTool,
    canvasClearTool,
  ];
}
