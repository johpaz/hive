import type { Tool } from "../agent/native-tools.ts";
import type { Config } from "../config/loader.ts";
import { canvasManager } from "./canvas-manager.ts";
import { logger } from "../utils/logger.ts";

export function createCanvasRenderTool(_config: Config): Tool {
  const log = logger.child("canvas-render");

  return {
    name: "canvas_render",
    description: "Render a component on the user's canvas",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to render to (auto-resolved from user context if omitted)",
        },
        component: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique component ID",
            },
            type: {
              type: "string",
              enum: ["button", "form", "chart", "table", "markdown", "text", "image"],
              description: "Component type",
            },
            props: {
              type: "object",
              description: "Component properties",
            },
            span: {
              type: "string",
              enum: ["full", "half"],
              description: "Width span: 'full' for full-width component, 'half' for half width. Default: single column",
            },
          },
          required: ["id", "type", "props"],
        },
      },
      required: ["component"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const component = params.component as {
        id: string;
        type: "button" | "form" | "chart" | "table" | "markdown" | "text" | "image" | "card" | "progress" | "list" | "confirm";
        props: Record<string, unknown>;
        span?: "full" | "half";
      };

      log.debug(`Rendering component ${component.id} to session ${sessionId}`);

      // Check if session is connected, if not try to render to any available session
      if (!canvasManager.isSessionConnected(sessionId)) {
        const connectedSessions = canvasManager.getConnectedSessions();
        if (connectedSessions.length > 0) {
          log.warn(`Session ${sessionId} not connected, using first available: ${connectedSessions[0]}`);
        } else {
          log.warn(`No canvas sessions connected. Rendering to ${sessionId} anyway.`);
        }
      }

      await canvasManager.render(sessionId, {
        id: component.id,
        type: component.type as any,
        props: component.props,
        span: component.span,
      });

      return {
        success: true,
        componentId: component.id,
        sessionId,
      };
    },
  };
}

export function createCanvasAskTool(_config: Config): Tool {
  const log = logger.child("canvas-ask");

  return {
    name: "canvas_ask",
    description: "Display a form and wait for user response",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID",
        },
        title: {
          type: "string",
          description: "Form title",
        },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["text", "email", "textarea", "select"] },
              required: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                  },
                },
              },
            },
            required: ["name", "label", "type"],
          },
          description: "Form fields",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 300000)",
        },
      },
      required: ["fields"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const title = (params.title as string) ?? "Form";
      const fields = params.fields as Array<{
        name: string;
        label: string;
        type: string;
        required?: boolean;
        options?: Array<{ label: string; value: string }>;
      }>;
      const timeout = (params.timeout as number) ?? 300000;

      const formId = `form-${Date.now()}`;

      log.debug(`Asking user via form ${formId}`);

      await canvasManager.render(sessionId, {
        id: formId,
        type: "form",
        props: { title, fields },
      });

      try {
        const response = await canvasManager.waitForInteraction(sessionId, formId, timeout);

        return {
          success: true,
          formId,
          data: response,
        };
      } catch (error) {
        return {
          success: false,
          formId,
          error: (error as Error).message,
        };
      }
    },
  };
}

export function createCanvasClearTool(_config: Config): Tool {
  const log = logger.child("canvas-clear");

  return {
    name: "canvas_clear",
    description: "Clear the canvas for a session",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to clear",
        },
      },
      required: [],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());

      log.debug(`Clearing canvas for session ${sessionId}`);

      await canvasManager.clear(sessionId);

      return { success: true, sessionId };
    },
  };
}

export function createCanvasTools(config: Config): Tool[] {
  return [
    createCanvasRenderTool(config),
    createCanvasAskTool(config),
    createCanvasClearTool(config),
    createCanvasCardTool(config),
    createCanvasProgressTool(config),
    createCanvasListTool(config),
    createCanvasConfirmTool(config),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Extended Canvas Tools for A2UI
// ═══════════════════════════════════════════════════════════════════════════

export function createCanvasCardTool(_config: Config): Tool {
  const log = logger.child("canvas-card");

  return {
    name: "canvas_show_card",
    description: "Display a card with labeled items (useful for showing status, summaries)",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        title: { type: "string", description: "Card title" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              variant: { type: "string", enum: ["default", "success", "warning", "danger"] },
            },
          },
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              variant: { type: "string", enum: ["primary", "secondary", "danger", "success"] },
            },
          },
        },
        span: {
          type: "string",
          enum: ["full", "half"],
          description: "Width span: 'full' for full-width card, 'half' for half width. Default: single column",
        },
      },
      required: ["items"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const title = (params.title as string) ?? "Information";
      const items = (params.items as Array<{ label: string; value: string; variant?: string }>) ?? [];
      const actions = (params.actions as Array<{ id: string; label: string; variant?: string }>) ?? [];
      const span = params.span as "full" | "half" | undefined;

      const cardId = `card-${Date.now()}`;

      await canvasManager.render(sessionId, {
        id: cardId,
        type: "card",
        props: { title, items, actions },
        span,
      });

      return { success: true, cardId, sessionId };
    },
  };
}

export function createCanvasProgressTool(_config: Config): Tool {
  const log = logger.child("canvas-progress");

  return {
    name: "canvas_show_progress",
    description: "Display progress bars for tasks (useful for multi-step operations)",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              progress: { type: "number" },
              status: { type: "string", enum: ["pending", "running", "completed", "error"] },
            },
          },
        },
        span: {
          type: "string",
          enum: ["full", "half"],
          description: "Width span: 'full' for full-width, 'half' for half width. Default: single column",
        },
      },
      required: ["tasks"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const tasks = (params.tasks as Array<{ id: string; name: string; progress: number; status?: string }>) ?? [];
      const span = params.span as "full" | "half" | undefined;

      const progressId = `progress-${Date.now()}`;

      await canvasManager.render(sessionId, {
        id: progressId,
        type: "progress",
        props: { tasks },
        span,
      });

      return { success: true, progressId, sessionId };
    },
  };
}

export function createCanvasListTool(_config: Config): Tool {
  const log = logger.child("canvas-list");

  return {
    name: "canvas_show_list",
    description: "Display a list of key-value pairs (useful for configuration display)",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        title: { type: "string", description: "List title" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        span: {
          type: "string",
          enum: ["full", "half"],
          description: "Width span: 'full' for full-width, 'half' for half width. Default: single column",
        },
      },
      required: ["items"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const title = (params.title as string) ?? "Details";
      const items = (params.items as Array<{ key: string; value: string }>) ?? [];
      const span = params.span as "full" | "half" | undefined;

      const listId = `list-${Date.now()}`;

      await canvasManager.render(sessionId, {
        id: listId,
        type: "list",
        props: { title, items },
        span,
      });

      return { success: true, listId, sessionId };
    },
  };
}

export function createCanvasConfirmTool(_config: Config): Tool {
  const log = logger.child("canvas-confirm");

  return {
    name: "canvas_confirm",
    description: "Show a confirmation dialog and wait for user response",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        title: { type: "string", description: "Dialog title" },
        message: { type: "string", description: "Confirmation message" },
        confirmLabel: { type: "string", description: "Confirm button label" },
        cancelLabel: { type: "string", description: "Cancel button label" },
        danger: { type: "boolean", description: "Show as dangerous action" },
        timeout: { type: "number", description: "Timeout in ms (default: 60000)" },
      },
      required: ["message"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());
      const title = (params.title as string) ?? "Confirm";
      const message = params.message as string;
      const confirmLabel = (params.confirmLabel as string) ?? "Confirm";
      const cancelLabel = (params.cancelLabel as string) ?? "Cancel";
      const danger = (params.danger as boolean) ?? false;
      const timeout = (params.timeout as number) ?? 60000;

      const confirmId = `confirm-${Date.now()}`;

      await canvasManager.render(sessionId, {
        id: confirmId,
        type: "confirm",
        props: { title, message, confirmLabel, cancelLabel, danger },
      });

      try {
        const response = await canvasManager.waitForInteraction(sessionId, confirmId, timeout);
        return { success: true, confirmed: response === true, confirmId, sessionId };
      } catch (error) {
        return { success: false, confirmed: false, confirmId, error: (error as Error).message, sessionId };
      }
    },
  };
}
