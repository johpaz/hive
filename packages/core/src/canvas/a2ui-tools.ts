import type { Tool } from "../agent/native-tools.ts";
import type { Config } from "../config/loader.ts";
import { canvasManager } from "./canvas-manager.ts";
import { logger } from "../utils/logger.ts";

export function createA2UISurfaceTool(_config: Config): Tool {
  const log = logger.child("a2ui-surface");

  return {
    name: "a2ui_create_surface",
    description: "Create an A2UI v0.9 surface on the user's canvas for rendering rich interactive UIs",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to render to (auto-resolved from user context if omitted)",
        },
        surfaceId: {
          type: "string",
          description: "Unique identifier for the UI surface (e.g. 'booking_form', 'user_profile'). Must be unique within the session.",
        },
        catalogId: {
          type: "string",
          description: "Catalog ID for the component set. Use 'https://a2ui.org/specification/v0_9/basic_catalog.json' for the standard catalog.",
        },
        theme: {
          type: "object",
          description: "Theme configuration for the surface",
          properties: {
            primaryColor: {
              type: "string",
              description: "Primary color in hex format (e.g. '#3B82F6')",
            },
            iconUrl: {
              type: "string",
              description: "URL for an icon/logo image",
            },
            agentDisplayName: {
              type: "string",
              description: "Display name for the agent that created this surface",
            },
          },
        },
        sendDataModel: {
          type: "boolean",
          description: "If true, the client will send the full data model with every action. Default: false.",
        },
      },
      required: ["surfaceId", "catalogId"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());

      if (!canvasManager.isSessionConnected(sessionId)) {
        const connected = canvasManager.getConnectedSessions();
        log.warn(`No canvas sessions connected. Rendering to ${sessionId} anyway. Available: ${connected.join(", ")}`);
      }

      await canvasManager.sendA2UIMessage(sessionId, "a2ui:createSurface", {
        surfaceId: params.surfaceId as string,
        catalogId: params.catalogId as string,
        theme: params.theme as Record<string, unknown> ?? {},
        sendDataModel: params.sendDataModel as boolean ?? false,
      });

      log.info(`Created A2UI surface '${params.surfaceId}' on session ${sessionId}`);
      return JSON.stringify({
        status: "created",
        surfaceId: params.surfaceId,
        sessionId,
      });
    },
  };
}

export function createA2UIUpdateComponentsTool(_config: Config): Tool {
  const log = logger.child("a2ui-components");

  return {
    name: "a2ui_update_components",
    description: `Send A2UI v0.9 components to an existing surface. Components are a FLAT list with ID references (adjacency list).

CHILDREN (spec oficial A2UI v0.9):
  Static: "children": ["id1", "id2"]  ← array crudo, formato oficial
  Template: "children": {"path": "/items", "componentId": "item_tmpl"}  ← formato oficial
  Single child (Card/Modal): "child": "child_id"

COMPONENT PROPS (nombres oficiales del spec):
  Text: text (string|{path}), variant ("h1"|"h2"|"h3"|"h4"|"h5"|"body"|"caption"|"code")
  Button: child (id del texto), variant ("default"|"primary"|"borderless"), action (required)
  TextField: label, value: {path:"/..."}, variant ("shortText"|"longText"|"number"|"obscured"), validationRegexp, action
    - action fires on blur or Enter key
  ChoicePicker: options [{label, value}], value: {path:"/..."}, variant ("mutuallyExclusive"|"multipleSelection"), displayStyle ("checkbox"|"chips"), filterable, action
    - value es DynamicStringList; two-way binding con value; action fires inmediatamente
  Slider: label, value: {path:"/..."}, min, max, step, action (fires on release)
  CheckBox: label, value: {path:"/..."} (DynamicBoolean, two-way binding)
  DateTimeInput: value: {path:"/..."}, enableDate, enableTime, min, max, label
  Tabs: tabs: [{title: "string plano", child: "id"}]  ← title es string, NO {literalString:...}
  Modal: trigger (id del botón), content (id del dialog)
  Card: child (único hijo), weight
  Row: children, justify ("start"|"center"|"end"|"spaceBetween"|"spaceAround"|"spaceEvenly"), align ("start"|"center"|"end"|"stretch"), weight
  Column: children, justify, align, weight
  List: children (con template path), direction ("vertical"|"horizontal"), align, weight
  Image: url, description, fit ("contain"|"cover"|"fill"|"none"|"scaleDown"), variant ("icon"|"avatar"|"smallFeature"|"mediumFeature"|"largeFeature"|"header")
  Divider: axis ("horizontal"|"vertical")

ACTION FORMAT (oficial: con wrapper event):
  {event: {name: "action_name", context: {key: {path: "/data/key"}}}}

DATA BINDING: "prop": "literal" | {path: "/json/pointer"} | {call: "fn", args: {...}}

Root component: usar id="root" explícito.`,
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to render to",
        },
        surfaceId: {
          type: "string",
          description: "The surface ID to update",
        },
        components: {
          type: "array",
          description: "Flat list of A2UI component definitions.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique component ID within the surface" },
              component: { type: "string", description: "Component type: Text, Button, Row, Column, Card, List, Divider, Image, Icon, Video, AudioPlayer, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput, Tabs, Modal" },
              weight: { type: "number", description: "Flex weight for proportional sizing inside Row/Column" },
            },
          },
        },
      },
      required: ["surfaceId", "components"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());

      await canvasManager.sendA2UIMessage(sessionId, "a2ui:updateComponents", {
        surfaceId: params.surfaceId as string,
        components: params.components,
      });

      log.info(`Updated A2UI components on surface '${params.surfaceId}' (${(params.components as any[]).length} components)`);
      return JSON.stringify({
        status: "updated",
        surfaceId: params.surfaceId,
        componentCount: (params.components as any[]).length,
      });
    },
  };
}

export function createA2UIUpdateDataModelTool(_config: Config): Tool {
  const log = logger.child("a2ui-data");

  return {
    name: "a2ui_update_data_model",
    description: "Update the data model for an A2UI v0.9 surface. The data model provides dynamic values that components can bind to via paths (e.g. '/user/name').",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to render to",
        },
        surfaceId: {
          type: "string",
          description: "The surface ID whose data model to update",
        },
        path: {
          type: "string",
          description: "JSON Pointer path to update (e.g. '/user/name'). If omitted, replaces the entire data model.",
        },
        value: {
          type: "object",
          description: "The new value for the specified path. Can be any JSON value.",
        },
      },
      required: ["surfaceId"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());

      await canvasManager.sendA2UIMessage(sessionId, "a2ui:updateDataModel", {
        surfaceId: params.surfaceId as string,
        path: params.path as string | undefined,
        value: params.value,
      });

      log.info(`Updated A2UI data model on surface '${params.surfaceId}' (path: ${params.path ?? "/"})`);
      return JSON.stringify({
        status: "updated",
        surfaceId: params.surfaceId,
        path: params.path ?? "/",
      });
    },
  };
}

export function createA2UIDeleteSurfaceTool(_config: Config): Tool {
  const log = logger.child("a2ui-delete");

  return {
    name: "a2ui_delete_surface",
    description: "Delete an A2UI v0.9 surface and remove it from the user's canvas",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID",
        },
        surfaceId: {
          type: "string",
          description: "The surface ID to delete",
        },
      },
      required: ["surfaceId"],
    },
    execute: async (params: Record<string, unknown>, config?: any) => {
      const userId = config?.configurable?.user_id;
      const rawSessionId = params.sessionId as string;
      const sessionId = rawSessionId
        ? (rawSessionId.startsWith("canvas:") ? rawSessionId : `canvas:${rawSessionId}`)
        : (userId ? `canvas:${userId}` : (() => { throw new Error("No session or user ID provided"); })());

      await canvasManager.sendA2UIMessage(sessionId, "a2ui:deleteSurface", {
        surfaceId: params.surfaceId as string,
      });

      log.info(`Deleted A2UI surface '${params.surfaceId}'`);
      return JSON.stringify({
        status: "deleted",
        surfaceId: params.surfaceId,
      });
    },
  };
}