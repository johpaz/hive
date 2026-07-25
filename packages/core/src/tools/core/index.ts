/**
 * Core Tools - 4 tools
 *
 * @category core
 */

import type { Tool } from "../types.ts";
import { col } from "../../storage/hive.ts";
import type { ToolDoc, SkillDoc, PlaybookDoc, McpToolDoc, TaskDoc, AgentDoc } from "../../storage/collections.ts";
import { logger } from "../../utils/logger.ts";
import {
  searchCapabilities,
  type CapabilityHit,
  type CapabilityType,
} from "../../agent/capability-search.ts";
import { CORE_TOOL_CATALOG } from "../../agent/tool-selector.ts";
import { saveScratchpadNote } from "../../agent/conversation-store.ts";

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
 * Translate a Spanish query to English equivalents for the bilingual BM25 fallback.
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

// ─── search_knowledge ────────────────────────────────────────────────────────

export const searchKnowledgeTool: Tool = {
  name: "search_knowledge",
  description: "Busca en TODO el conocimiento de Hive: tools nativas, MCP, skills, agentes de catálogo y playbook.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Una palabra clave. Ejemplos: 'email', 'github', 'pdf', 'browser', 'calendar'. Busca en nombres, descripciones y categorías.",
      },
      type: {
        type: "string",
        enum: ["all", "tools", "skills", "playbook", "mcp", "agents"],
        description: "Opcional. Por defecto 'all' (busca en todo). Usa 'mcp' para filtrar solo herramientas externas, 'tools' para solo nativas.",
      },
      limit: {
        type: "number",
        description: "Máximo de resultados (default: 10)",
      },
    },
    required: ["query"],
  },
  execute: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    const type = (params.type as string) ?? "all";
    const limit = (params.limit as number) ?? 10;
    const MIN_RESULTS_FOR_BILINGUAL = 2;

    // Map the tool's `type` param onto capability types
    const typeMap: Record<string, CapabilityType[] | undefined> = {
      all: undefined,
      tools: ["tool"],
      skills: ["skill"],
      playbook: ["playbook"],
      mcp: ["mcp"],
      agents: ["agent"],
    };
    const types = typeMap[type] ?? undefined;

    try {
      if (!query) {
        log.info(`[search_knowledge] Empty query — returning empty results`)
        return { query, type, tools: [], skills: [], playbook: [], toolsmcp: [], agents: [] }
      }
      // HiveDB parses raw text leniently (accents, quotes, operators are all
      // safe), so the query goes in as-is — only underscores become spaces so
      // tool ids like "send_email" match their tokens.
      const normalizedQuery = query.replace(/_/g, " ").trim();

      const result: any = { query, type, tools: [], skills: [], playbook: [], toolsmcp: [], agents: [] };

      // ─── Hydration from HiveDB collections (index stores only ids + search text) ──

      const coreCatalog = new Map(CORE_TOOL_CATALOG.map(t => [t.name, t]));

      const toolsCol = await col<ToolDoc>("tools");
      const skillsCol = await col<SkillDoc>("skills");
      const playbookCol = await col<PlaybookDoc>("playbook");
      const mcpToolsCol = await col<McpToolDoc>("mcpTools");
      const agentsCol = await col<AgentDoc>("agents");

      async function hydrateTool(hit: CapabilityHit): Promise<any | null> {
        const entry = await toolsCol.get(hit.rawId);
        if (entry) {
          const row = entry.doc;
          return {
            id: row.id, name: row.name, description: row.description, category: row.category,
            enabled: row.enabled, active: row.active, rank: hit.score,
          };
        }
        // Core catalog tools may not exist in the tools collection
        const cat = coreCatalog.get(hit.rawId);
        if (!cat) return null;
        return {
          id: cat.name, name: cat.name, description: cat.description, category: cat.category,
          enabled: true, active: true, rank: hit.score,
        };
      }

      async function hydrateSkill(hit: CapabilityHit): Promise<any | null> {
        const entry = await skillsCol.get(hit.rawId);
        const s = entry?.doc;
        if (!s || !s.active) return null;
        return {
          id: s.id, name: s.name, description: s.description, category: s.category,
          tools: s.tools, triggers: s.triggers,
          preferred_agents: s.preferred_agents ? JSON.parse(s.preferred_agents) : [],
          body: s.body ? (s.body.length > 1500 ? s.body.substring(0, 1500) + "…" : s.body) : undefined,
          active: s.active, rank: hit.score,
        };
      }

      async function hydratePlaybook(hit: CapabilityHit): Promise<any | null> {
        const entry = await playbookCol.get(hit.rawId);
        const p = entry?.doc;
        if (!p || !p.active) return null;
        return {
          id: p.id, rule: p.rule, category: p.category,
          applicable_to: p.applicable_to ? JSON.parse(p.applicable_to) : null,
          helpful_count: p.helpful_count, harmful_count: p.harmful_count,
          active: p.active, rank: hit.score,
        };
      }

      async function hydrateMcp(hit: CapabilityHit): Promise<any | null> {
        const entry = await mcpToolsCol.get(hit.rawId);
        const t = entry?.doc;
        if (!t || !t.active) return null;
        return {
          id: t.id, full_name: t.id, server_name: t.server_name, tool_name: t.tool_name,
          description: t.description, category: t.category,
          active: t.active, rank: hit.score,
        };
      }

      async function hydrateAgent(hit: CapabilityHit): Promise<any | null> {
        const entry = await agentsCol.get(hit.rawId);
        const agent = entry?.doc;
        if (!agent || agent.source !== "catalog" || !agent.enabled) return null;
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          default_acceptance: agent.default_acceptance_json ? JSON.parse(agent.default_acceptance_json) : [],
          active: agent.enabled,
          rank: hit.score,
        };
      }

      const seenIds = new Set<string>();

      async function mergeHits(hits: CapabilityHit[]): Promise<number> {
        let added = 0;
        for (const hit of hits) {
          if (seenIds.has(hit.id)) continue;
          let entry: any = null;
          let bucket: any[] | null = null;
          switch (hit.type) {
            case "tool":
              if (result.tools.length < limit) { entry = await hydrateTool(hit); bucket = result.tools; }
              break;
            case "skill":
              if (result.skills.length < limit) { entry = await hydrateSkill(hit); bucket = result.skills; }
              break;
            case "playbook":
              if (result.playbook.length < limit) { entry = await hydratePlaybook(hit); bucket = result.playbook; }
              break;
            case "mcp":
              if (result.toolsmcp.length < limit) { entry = await hydrateMcp(hit); bucket = result.toolsmcp; }
              break;
            case "agent":
              if (result.agents.length < limit) { entry = await hydrateAgent(hit); bucket = result.agents; }
              break;
          }
          if (entry && bucket) {
            bucket.push(entry);
            seenIds.add(hit.id);
            added++;
          }
        }
        return added;
      }

      // ─── Pass 1: Search with original query ─────────────────────────
      // `rank` is the raw BM25 score: positive, higher = more relevant.

      const hits1 = await searchCapabilities(normalizedQuery, { types, k: limit * 4 });
      const totalFirst = await mergeHits(hits1);

      // ─── Pass 2: Bilingual fallback (ES → EN) ──────────────────────
      // HiveDB stems Spanish but does not translate: "correo" still won't
      // match English-only descriptions ("email") without this dictionary.

      if (totalFirst < MIN_RESULTS_FOR_BILINGUAL) {
        const englishQuery = translateQueryToEnglish(normalizedQuery);
        if (englishQuery.length > 0) {
          log.info(`[search_knowledge] Bilingual fallback: "${normalizedQuery}" → "${englishQuery}" (first pass: ${totalFirst} results)`);
          const hits2 = await searchCapabilities(englishQuery, { types, k: limit * 4 });
          await mergeHits(hits2);
        }
      }

      result.totalResults = result.tools.length + result.skills.length + result.playbook.length + result.toolsmcp.length + result.agents.length;

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
    const key = params.key as string;
    const value = params.value as string;
    const threadId = (params.thread_id as string) ?? config?.configurable?.thread_id ?? "default";

    try {
      await saveScratchpadNote(threadId, key, value, "agent");
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
      try {
        const tasksCol = await col<TaskDoc>("tasks");
        const id = /^\d+$/.test(taskId) ? taskId.padStart(15, "0") : taskId;
        const existing = await tasksCol.get(id);
        if (existing) {
          await tasksCol.put(id, { ...existing.doc, progress, updated_at: Date.now() }, { expectedVersion: existing.version });
        }
      } catch {
        // Best-effort — task_id may not correspond to a real task.
      }
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
