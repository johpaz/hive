/**
 * Core Tools - 4 tools
 *
 * @category core
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("core");

// ─── search_knowledge ────────────────────────────────────────────────────────

export const searchKnowledgeTool: Tool = {
  name: "search_knowledge",
  description: "Busca herramientas NATIVAS (tools), habilidades (skills) o reglas del playbook en la base de conocimientos. Usa búsqueda full-text (FTS5). Las herramientas MCP ya están disponibles directamente - no necesitas buscarlas.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Término de búsqueda (nombre, descripción, categoría)",
      },
      type: {
        type: "string",
        enum: ["all", "tools", "skills", "playbook"],
        description: "Tipo de conocimiento a buscar",
      },
      limit: {
        type: "number",
        description: "Máximo de resultados (default: 10)",
      },
    },
    required: ["query"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const query = params.query as string;
    const type = (params.type as string) ?? "all";
    const limit = (params.limit as number) ?? 10;

    try {
      const escapedQuery = query.replace(/'/g, "''");
      const normalizedQuery = escapedQuery.replace(/_/g, " ").trim();
      // Mejor estrategia FTS5: múltiples palabras = AND entre términos con wildcard
      const words = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
      const ftsMatch = words.length > 1
        ? words.map(w => `${w}*`).join(' AND ')  // email* AND send*
        : `"${normalizedQuery}" OR ${normalizedQuery}*`;  // "send" OR send*

      const result: any = { query, type, tools: [], skills: [], playbook: [], toolsmcp: [] };

      // Search tools
      if (type === "all" || type === "tools") {
        const tools = db.query(`
          SELECT
            COALESCE(t.id, tools_fts.tool_name) as id,
            COALESCE(t.name, tools_fts.tool_name) as name,
            COALESCE(t.description, tools_fts.description) as description,
            COALESCE(t.category, tools_fts.category) as category,
            COALESCE(t.enabled, 1) as enabled,
            COALESCE(t.active, 1) as active,
            bm25(tools_fts) as rank
          FROM tools_fts
          LEFT JOIN tools t ON t.name = tools_fts.tool_name
          WHERE tools_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsMatch, limit) as any[];

        result.tools = tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          enabled: t.enabled === 1,
          active: t.active === 1,
          rank: t.rank,
        }));
      }

      // Search skills
      if (type === "all" || type === "skills") {
        const skills = db.query(`
          SELECT s.id, s.name, s.category, s.tools, s.triggers, s.body, s.active, bm25(skills_fts) as rank
          FROM skills_fts
          JOIN skills s ON s.id = skills_fts.id
          WHERE skills_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsMatch, limit) as any[];

        result.skills = skills.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          tools: s.tools,
          triggers: s.triggers,
          body: s.body ? (s.body.length > 400 ? s.body.substring(0, 400) + "…" : s.body) : undefined,
          active: s.active === 1,
          rank: s.rank,
        }));
      }

      // Search playbook
      if (type === "all" || type === "playbook") {
        const playbook = db.query(`
          SELECT p.id, p.rule, p.category, p.applicable_to, p.helpful_count, p.harmful_count, p.active, bm25(playbook_fts) as rank
          FROM playbook_fts
          JOIN playbook p ON p.id = playbook_fts.rowid
          WHERE playbook_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsMatch, limit) as any[];

        result.playbook = playbook.map((p) => ({
          id: p.id,
          rule: p.rule,
          category: p.category,
          applicable_to: p.applicable_to ? JSON.parse(p.applicable_to) : null,
          helpful_count: p.helpful_count,
          harmful_count: p.harmful_count,
          active: p.active === 1,
          rank: p.rank,
        }));
      }

      result.totalResults = result.tools.length + result.skills.length + result.playbook.length;

      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: `Search failed: ${(error as Error).message}`,
      };
    }
  },
};

// ─── notify ──────────────────────────────────────────────────────────────────

export const notifyTool: Tool = {
  name: "notify",
  description: "Send a notification or progress update to the user's active channel. Use this to keep the user informed while working on long tasks.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Notification message to send to the user",
      },
    },
    required: ["message"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const { sendToUserChannel } = await import("../../gateway/channel-notify");
    const message = params.message as string;
    const channel = (config?.configurable?.channel as string) ?? "webchat";
    const userId = (config?.configurable?.user_id as string) ?? "";

    log.info(`[notify] Sending to ${channel}/${userId}: ${message.substring(0, 80)}`);

    return sendToUserChannel(channel, userId, message);
  },
};

// ─── save_note (scratchpad) ──────────────────────────────────────────────────

export const saveNoteTool: Tool = {
  name: "save_note",
  description: "Save a note to the scratchpad (survives context compression).",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Unique key for the note",
      },
      value: {
        type: "string",
        description: "Note content",
      },
      thread_id: {
        type: "string",
        description: "Thread ID (optional, uses current thread if not specified)",
      },
    },
    required: ["key", "value"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const key = params.key as string;
    const value = params.value as string;
    const threadId = (params.thread_id as string) ?? config?.configurable?.thread_id ?? "default";

    try {
      db.query(`
        INSERT OR REPLACE INTO scratchpad (thread_id, key, value, source, updated_at)
        VALUES (?, ?, ?, 'agent', unixepoch())
      `).run(threadId, key, value);

      return { ok: true, key, message: "Note saved." };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to save note: ${(error as Error).message}`,
      };
    }
  },
};

// ─── report_progress ─────────────────────────────────────────────────────────

export const reportProgressTool: Tool = {
  name: "report_progress",
  description: "Report progress of an ongoing task to the user. Sends a real-time update to the active channel. Use frequently during long operations so the user knows what's happening.",
  parameters: {
    type: "object",
    properties: {
      progress: {
        type: "number",
        description: "Progress percentage (0-100)",
      },
      message: {
        type: "string",
        description: "Progress message describing what you are currently doing",
      },
      task_id: {
        type: "string",
        description: "Task or project ID (optional)",
      },
    },
    required: ["progress", "message"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const { sendToUserChannel } = await import("../../gateway/channel-notify");
    const progress = params.progress as number;
    const message = params.message as string;
    const taskId = (params.task_id as string) ?? null;
    const channel = (config?.configurable?.channel as string) ?? "webchat";
    const userId = (config?.configurable?.user_id as string) ?? "";

    log.info(`[report_progress] ${progress}% — ${message}`);

    // Update task progress in DB if task_id provided
    if (taskId) {
      const db = getDb();
      db.query(`UPDATE tasks SET progress = ?, updated_at = unixepoch() WHERE id = ?`).run(progress, taskId);
    }

    // Send real-time update to the user's channel
    const progressEmoji = progress >= 100 ? "✅" : progress >= 50 ? "⚙️" : "🔄";
    await sendToUserChannel(channel, userId, `${progressEmoji} ${progress}% — ${message}`);

    return { ok: true, progress, message, task_id: taskId };
  },
};

export function createTools(): Tool[] {
  return [searchKnowledgeTool, notifyTool, saveNoteTool, reportProgressTool];
}
