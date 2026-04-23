/**
 * Core Tools - 4 tools
 *
 * @category core
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("core");

// ─── Bilingual dictionary: Spanish → English ────────────────────────────────

const ES_EN_DICT: Record<string, string[]> = {
  // Acciones
  "buscar": ["search", "find", "list", "get", "query"],
  "listar": ["list", "get", "fetch", "retrieve"],
  "crear": ["create", "add", "insert", "new", "make"],
  "actualizar": ["update", "edit", "modify", "change"],
  "eliminar": ["delete", "remove", "destroy"],
  "obtener": ["get", "fetch", "retrieve", "read"],
  "enviar": ["send", "post", "submit", "push"],
  "leer": ["read", "get", "fetch"],
  "escribir": ["write", "create", "save"],
  "modificar": ["update", "modify", "edit", "change"],
  "ejecutar": ["execute", "run", "invoke"],
  "conectar": ["connect", "link"],
  "desconectar": ["disconnect", "remove"],
  "descargar": ["download", "export", "fetch"],
  "subir": ["upload", "import", "create"],
  "analizar": ["analyze", "review", "examine"],
  "generar": ["generate", "create", "produce"],
  "convertir": ["convert", "transform", "translate"],
  "validar": ["validate", "verify", "check"],
  "importar": ["import", "load", "ingest"],
  "exportar": ["export", "download", "extract"],
  "comprimir": ["compress", "zip", "archive"],
  "extraer": ["extract", "get", "retrieve", "parse"],
  "reemplazar": ["replace", "update", "swap"],
  "cargar": ["load", "import", "upload"],
  "guardar": ["save", "store", "create"],
  "consultar": ["query", "search", "get", "list"],
  "registrar": ["register", "create", "log", "record"],
  "programar": ["schedule", "plan", "cron"],
  "notificar": ["notify", "alert", "send"],
  "reiniciar": ["restart", "reset", "reboot"],
  "configurar": ["configure", "setup", "set"],
  "autenticar": ["authenticate", "login", "auth"],
  "publicar": ["publish", "deploy", "release"],
  "desplegar": ["deploy", "publish", "release"],
  "copiar": ["copy", "clone", "duplicate"],
  "mover": ["move", "transfer", "migrate"],
  "comparar": ["compare", "diff", "match"],
  "fusionar": ["merge", "combine", "join"],
  "dividir": ["split", "divide", "partition"],
  "filtrar": ["filter", "search", "query"],
  "ordenar": ["sort", "order", "arrange"],
  "traducir": ["translate", "convert"],

  // Entidades
  "base": ["base", "database", "db"],
  "bases": ["bases", "databases"],
  "datos": ["data", "records", "rows", "entries"],
  "registro": ["record", "entry", "row", "item"],
  "registros": ["records", "entries", "rows", "items"],
  "tabla": ["table", "schema", "collection"],
  "tablas": ["tables", "schemas"],
  "campo": ["field", "column", "property"],
  "campos": ["fields", "columns", "properties"],
  "usuario": ["user", "account"],
  "usuarios": ["users", "accounts"],
  "proyecto": ["project", "repo", "workspace"],
  "proyectos": ["projects", "repos", "workspaces"],
  "archivo": ["file", "document"],
  "archivos": ["files", "documents"],
  "correo": ["email", "mail", "message"],
  "correos": ["emails", "mails", "messages"],
  "noticia": ["news", "article", "post"],
  "noticias": ["news", "articles", "posts"],
  "contenido": ["content", "data", "text"],
  "tarea": ["task", "job", "issue", "ticket"],
  "tareas": ["tasks", "jobs", "issues", "tickets"],
  "pagina": ["page", "site", "web"],
  "enlace": ["link", "url", "reference"],
  "imagen": ["image", "picture", "photo"],
  "video": ["video", "media"],
  "audio": ["audio", "sound", "media"],
  "categoria": ["category", "tag", "label"],
  "estado": ["status", "state", "condition"],
  "error": ["error", "exception", "fault"],
  "fuente": ["source", "origin", "reference"],
  "esquema": ["schema", "structure", "model"],
  "respuesta": ["response", "reply", "answer"],
  "solicitud": ["request", "query", "call"],
  "repositorio": ["repository", "repo"],
  "seguridad": ["security", "auth", "permission"],
  "permiso": ["permission", "role", "access"],
  "acceso": ["access", "login", "entry"],
  "servidor": ["server", "host", "service"],
  "conexion": ["connection", "link", "integration"],
  "integracion": ["integration", "connector", "plugin"],
  "herramienta": ["tool", "utility", "function"],
  "informacion": ["info", "information", "details"],
  "lista": ["list", "collection", "array"],
  "reporte": ["report", "summary", "analytics"],
  "metrica": ["metric", "stat", "analytics"],
  "contacto": ["contact", "lead", "person"],
};

/**
 * Translate a Spanish query to English equivalents for FTS5 fallback.
 * Returns an array of English keyword tokens.
 */
function translateQueryToEnglish(query: string): string {
  const words = query.toLowerCase().replace(/_/g, " ").split(/\s+/).filter(w => w.length > 1);
  const translated: string[] = [];

  for (const word of words) {
    const equivalents = ES_EN_DICT[word];
    if (equivalents) {
      translated.push(...equivalents);
    }
  }

  return [...new Set(translated)].join(" ");
}

/**
 * Build an FTS5 MATCH expression from a list of words.
 * Multi-word: AND with prefix wildcard. Single: exact OR prefix.
 */
function buildFtsMatch(words: string[]): string {
  if (words.length > 1) {
    return words.map(w => `${w}*`).join(' AND ');
  }
  return `"${words.join(' ')}" OR ${words[0]}*`;
}

// ─── search_knowledge ────────────────────────────────────────────────────────

export const searchKnowledgeTool: Tool = {
  name: "search_knowledge",
  description: "Busca herramientas NATIVAS (tools), MCP (tools externas), habilidades (skills) o reglas del playbook en la base de conocimientos. Usa búsqueda full-text (FTS5) con fallback bilingüe español→inglés. type='mcp' para herramientas MCP, type='all' para buscar en todo.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Término de búsqueda (nombre, descripción, categoría). Se busca primero en español, luego en inglés si hay pocos resultados.",
      },
      type: {
        type: "string",
        enum: ["all", "tools", "skills", "playbook", "mcp"],
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
    const MIN_RESULTS_FOR_BILINGUAL = 2;

    try {
      const escapedQuery = query.replace(/'/g, "''");
      const normalizedQuery = escapedQuery.replace(/_/g, " ").trim();
      const words = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
      const ftsMatch = buildFtsMatch(words);

      const result: any = { query, type, tools: [], skills: [], playbook: [], toolsmcp: [] };

      // ─── Search functions (reusable for bilingual fallback) ───────────

      function searchTools(matchExpr: string): any[] {
        if (type !== "all" && type !== "tools") return [];
        try {
          return db.query(`
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
          `).all(matchExpr, limit) as any[];
        } catch { return []; }
      }

      function searchSkills(matchExpr: string): any[] {
        if (type !== "all" && type !== "skills") return [];
        try {
          return db.query(`
            SELECT s.id, s.name, s.description, s.category, s.tools, s.triggers, s.preferred_agents, s.body, s.active, bm25(skills_fts) as rank
            FROM skills_fts
            JOIN skills s ON s.id = skills_fts.id
            WHERE skills_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(matchExpr, limit) as any[];
        } catch { return []; }
      }

      function searchPlaybook(matchExpr: string): any[] {
        if (type !== "all" && type !== "playbook") return [];
        try {
          return db.query(`
            SELECT p.id, p.rule, p.category, p.applicable_to, p.helpful_count, p.harmful_count, p.active, bm25(playbook_fts) as rank
            FROM playbook_fts
            JOIN playbook p ON p.id = playbook_fts.rowid
            WHERE playbook_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(matchExpr, limit) as any[];
        } catch { return []; }
      }

      function searchMcpTools(matchExpr: string): any[] {
        if (type !== "all" && type !== "mcp") return [];
        try {
          return db.query(`
            SELECT m.id, m.server_name, m.tool_name, m.description, m.category, m.active, bm25(mcp_tools_fts) as rank
            FROM mcp_tools_fts
            JOIN mcp_tools m ON m.id = mcp_tools_fts.id
            WHERE mcp_tools_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(matchExpr, limit) as any[];
        } catch { return []; }
      }

      // ─── Pass 1: Search with original query ─────────────────────────

      const tools1 = searchTools(ftsMatch);
      const skills1 = searchSkills(ftsMatch);
      const playbook1 = searchPlaybook(ftsMatch);
      const mcp1 = searchMcpTools(ftsMatch);

      const totalFirst = tools1.length + skills1.length + playbook1.length + mcp1.length;

      // Map results
      result.tools = tools1.map((t: any) => ({
        id: t.id, name: t.name, description: t.description, category: t.category,
        enabled: t.enabled === 1, active: t.active === 1, rank: t.rank,
      }));
      result.skills = skills1.map((s: any) => ({
        id: s.id, name: s.name, description: s.description, category: s.category,
        tools: s.tools, triggers: s.triggers,
        preferred_agents: s.preferred_agents ? JSON.parse(s.preferred_agents) : [],
        body: s.body ? (s.body.length > 400 ? s.body.substring(0, 400) + "…" : s.body) : undefined,
        active: s.active === 1, rank: s.rank,
      }));
      result.playbook = playbook1.map((p: any) => ({
        id: p.id, rule: p.rule, category: p.category,
        applicable_to: p.applicable_to ? JSON.parse(p.applicable_to) : null,
        helpful_count: p.helpful_count, harmful_count: p.harmful_count,
        active: p.active === 1, rank: p.rank,
      }));
      result.toolsmcp = mcp1.map((t: any) => ({
        id: t.id, full_name: t.id, server_name: t.server_name, tool_name: t.tool_name,
        description: t.description, category: t.category,
        active: t.active === 1, rank: t.rank,
      }));

      // ─── Pass 2: Bilingual fallback (ES → EN) ──────────────────────

      if (totalFirst < MIN_RESULTS_FOR_BILINGUAL) {
        const englishQuery = translateQueryToEnglish(normalizedQuery);
        if (englishQuery.length > 0) {
          const enWords = englishQuery.split(/\s+/).filter(w => w.length > 0);
          const enMatch = buildFtsMatch(enWords);

          log.info(`[search_knowledge] Bilingual fallback: "${normalizedQuery}" → "${englishQuery}" (first pass: ${totalFirst} results)`);

          const existingIds = new Set([
            ...result.tools.map((t: any) => t.name),
            ...result.skills.map((s: any) => s.id),
            ...result.playbook.map((p: any) => p.id),
            ...result.toolsmcp.map((t: any) => t.id),
          ]);

          // Merge English results (dedup by id)
          for (const t of searchTools(enMatch)) {
            if (!existingIds.has(t.name || t.id)) {
              result.tools.push({
                id: t.id, name: t.name, description: t.description, category: t.category,
                enabled: t.enabled === 1, active: t.active === 1, rank: t.rank,
              });
              existingIds.add(t.name || t.id);
            }
          }
          for (const s of searchSkills(enMatch)) {
            if (!existingIds.has(s.id)) {
              result.skills.push({
                id: s.id, name: s.name, description: s.description, category: s.category,
                tools: s.tools, triggers: s.triggers,
                preferred_agents: s.preferred_agents ? JSON.parse(s.preferred_agents) : [],
                body: s.body ? (s.body.length > 400 ? s.body.substring(0, 400) + "…" : s.body) : undefined,
                active: s.active === 1, rank: s.rank,
              });
              existingIds.add(s.id);
            }
          }
          for (const p of searchPlaybook(enMatch)) {
            if (!existingIds.has(p.id)) {
              result.playbook.push({
                id: p.id, rule: p.rule, category: p.category,
                applicable_to: p.applicable_to ? JSON.parse(p.applicable_to) : null,
                helpful_count: p.helpful_count, harmful_count: p.harmful_count,
                active: p.active === 1, rank: p.rank,
              });
              existingIds.add(p.id);
            }
          }
          for (const t of searchMcpTools(enMatch)) {
            if (!existingIds.has(t.id)) {
              result.toolsmcp.push({
                id: t.id, full_name: t.id, server_name: t.server_name, tool_name: t.tool_name,
                description: t.description, category: t.category,
                active: t.active === 1, rank: t.rank,
              });
              existingIds.add(t.id);
            }
          }
        }
      }

      result.totalResults = result.tools.length + result.skills.length + result.playbook.length + result.toolsmcp.length;

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

    const result = await sendToUserChannel(channel, userId, message)
    if (!result.ok) throw new Error(`Channel send failed: ${result.error}`)
    return result
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
    const result = await sendToUserChannel(channel, userId, `${progressEmoji} ${progress}% — ${message}`)
    if (!result.ok) throw new Error(`Channel send failed: ${result.error}`)

    return { ok: true, progress, message, task_id: taskId };
  },
};

export function createTools(): Tool[] {
  return [searchKnowledgeTool, notifyTool, saveNoteTool, reportProgressTool];
}