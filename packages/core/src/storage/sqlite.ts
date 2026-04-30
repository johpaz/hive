import { Database } from "bun:sqlite";
import { logger } from "../utils/logger.ts";
import * as path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { getHiveDir } from "../config/loader.ts";
import { SCHEMA, PROJECTS_SCHEMA, CONTEXT_ENGINE_SCHEMA, MEETING_SCHEMA } from "./schema.ts";

function getDbPath(): string {
    return path.join(getHiveDir(), "data", "hive.db");
}

export function getDbPathLazy(): string {
    return getDbPath();
}

let _db: Database | null = null;

export function getDb(): Database {
    if (!_db) throw new Error("DB no inicializada. Llama initializeDatabase() primero.");
    return _db;
}


export function initializeDatabase(): Database {
    const hiveDir = getHiveDir();
    const dir = path.join(hiveDir, "data");
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    const dbPath = getDbPath();
    const dbFileExists = existsSync(dbPath);

    _db = new Database(dbPath, { create: true });

    // ── Pre-schema migration: drop legacy cron tables before SCHEMA exec ──
    // This must happen BEFORE SCHEMA runs, because CREATE TABLE IF NOT EXISTS
    // will skip if the old table exists, leaving us with the wrong schema.
    try {
        const cronJobsCols = _db.query(`PRAGMA table_info(cron_jobs)`).all() as any[];
        if (cronJobsCols.length > 0) {
            const cronColNames = cronJobsCols.map((c: any) => c.name);
            const needsMigration = cronColNames.includes("enabled")
                || cronColNames.includes("user_id")
                || !cronColNames.includes("status")
                || !cronColNames.includes("task");

            if (needsMigration) {
                logger.info("🛠️  Dropping legacy cron_jobs table for schema rebuild...");
                // Drop FK references first
                try { _db.run(`DROP TRIGGER IF EXISTS update_cron_jobs_updated_at`); } catch {}
                try { _db.run(`DROP TRIGGER IF EXISTS update_scheduled_tasks_updated_at`); } catch {}
                try { _db.run(`DROP TABLE IF EXISTS task_runs`); } catch {}
                _db.run(`DROP TABLE cron_jobs`);
                logger.info("✅ Legacy cron_jobs table dropped — will be recreated by SCHEMA");
            }
        }

        // Also drop scheduled_tasks if it exists (will be recreated with new name)
        const stCheck = _db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_tasks'`).all() as any[];
        if (stCheck.length > 0) {
            logger.info("🛠️  Dropping legacy scheduled_tasks table...");
            try { _db.run(`DROP TRIGGER IF EXISTS update_scheduled_tasks_updated_at`); } catch {}
            _db.run(`DROP TABLE scheduled_tasks`);
            logger.info("✅ Legacy scheduled_tasks table dropped");
        }

        // Drop old indexes that reference legacy columns
        try { _db.run(`DROP INDEX IF EXISTS idx_cron_jobs_user`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_cron_jobs_enabled`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_cron_jobs_next_run`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_scheduled_tasks_status`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_scheduled_tasks_type`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_scheduled_tasks_next_run`); } catch {}
        try { _db.run(`DROP INDEX IF EXISTS idx_scheduled_tasks_agent`); } catch {}
    } catch (preSchemaErr) {
        logger.warn("⚠️  Pre-schema migration check failed:", { error: (preSchemaErr as Error).message });
    }

    _db.run(SCHEMA);
    _db.run(PROJECTS_SCHEMA);
    _db.run(CONTEXT_ENGINE_SCHEMA);
    _db.run(MEETING_SCHEMA);

    ensureSchemaSync();

    return _db;
}

function ensureColumnExists(tableName: string, columnName: string, columnDefinition: string): void {
    if (!_db) return;
    try {
        const info = _db.query(`PRAGMA table_info(${tableName})`).all() as any[];
        const exists = info.some((col: any) => col.name === columnName);

        if (!exists) {
            logger.info(`🛠️  Añadiendo columna faltante '${columnName}' a la tabla '${tableName}'`);
            _db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        }
    } catch (err) {
        logger.warn(`⚠️  No se pudo verificar/añadir la columna '${columnName}' en '${tableName}':`, { error: (err as Error).message });
    }
}

function ensureSchemaSync(): void {
    if (!_db) return;

    // Sync users (auth columns)
    ensureColumnExists("users", "email", "TEXT");
    ensureColumnExists("users", "password_hash", "TEXT");

    // Sync mcp_servers
    ensureColumnExists("mcp_servers", "tools_count", "INTEGER DEFAULT 0");
    ensureColumnExists("mcp_servers", "status", "TEXT NOT NULL DEFAULT 'disconnected'");
    ensureColumnExists("mcp_servers", "env_encrypted", "TEXT");
    ensureColumnExists("mcp_servers", "env_iv", "TEXT");
    ensureColumnExists("mcp_servers", "headers_encrypted", "TEXT");
    ensureColumnExists("mcp_servers", "headers_iv", "TEXT");

    // Sync providers
    ensureColumnExists("providers", "api_key_encrypted", "TEXT");
    ensureColumnExists("providers", "api_key_iv", "TEXT");
    ensureColumnExists("providers", "headers_encrypted", "TEXT");
    ensureColumnExists("providers", "headers_iv", "TEXT");
    ensureColumnExists("providers", "num_ctx", "INTEGER");
    ensureColumnExists("providers", "num_gpu", "INTEGER DEFAULT -1");

    // Sync agents (new Context Engine columns — safe no-ops if already present)
    ensureColumnExists("agents", "headers_encrypted", "TEXT");
    ensureColumnExists("agents", "headers_iv", "TEXT");
    ensureColumnExists("agents", "system_prompt", "TEXT");
    ensureColumnExists("agents", "role", "TEXT NOT NULL DEFAULT 'coordinator'");
    ensureColumnExists("agents", "tools_json", "TEXT");
    ensureColumnExists("agents", "skills_json", "TEXT");
    ensureColumnExists("agents", "parent_id", "TEXT");
    ensureColumnExists("agents", "max_iterations", "INTEGER NOT NULL DEFAULT 10");
    ensureColumnExists("agents", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("agents", "workspace", "TEXT");

    // Sync tasks (new Context Engine columns)
    ensureColumnExists("tasks", "priority", "INTEGER NOT NULL DEFAULT 0");
    ensureColumnExists("tasks", "depends_on", "TEXT");
    ensureColumnExists("tasks", "error", "TEXT");
    ensureColumnExists("tasks", "completed_at", "INTEGER");

    // Sync tools (new columns)
    ensureColumnExists("tools", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("tools", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");

    // Sync skills (new columns)
    ensureColumnExists("skills", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("skills", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");

// ── Cron Jobs: ensure triggers and columns are correct ──
    // Triggers: clean up old references and recreate
    try {
        _db.run(`DROP TRIGGER IF EXISTS update_scheduled_tasks_updated_at`);
        _db.run(`DROP TRIGGER IF EXISTS update_cron_jobs_updated_at`);
        _db.run(`CREATE TRIGGER IF NOT EXISTS update_cron_jobs_updated_at
            AFTER UPDATE ON cron_jobs
            BEGIN
                UPDATE cron_jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
            END`);
    } catch (triggerErr) {
        logger.warn("⚠️  Failed to recreate trigger:", { error: (triggerErr as Error).message });
    }

    // Ensure new columns exist (for incremental upgrades)
    ensureColumnExists("cron_jobs", "task", "TEXT NOT NULL DEFAULT ''");
    ensureColumnExists("cron_jobs", "status", "TEXT NOT NULL DEFAULT 'active'");
    ensureColumnExists("cron_jobs", "task_type", "TEXT NOT NULL DEFAULT 'recurring'");
    ensureColumnExists("cron_jobs", "start_at", "TEXT");
    ensureColumnExists("cron_jobs", "stop_at", "TEXT");
    ensureColumnExists("cron_jobs", "dom_and_dow", "INTEGER NOT NULL DEFAULT 0");
    ensureColumnExists("cron_jobs", "fire_at", "TEXT");
    ensureColumnExists("cron_jobs", "protect", "INTEGER NOT NULL DEFAULT 1");
    ensureColumnExists("cron_jobs", "interval_sec", "INTEGER");
    ensureColumnExists("cron_jobs", "agent_id", "TEXT");
    ensureColumnExists("cron_jobs", "completed_at", "TEXT");

    // Context Engine tables — ensure created_at/updated_at columns exist
    ensureColumnExists("conversations", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("conversations", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("conversations", "content_multimodal", "TEXT");
    ensureColumnExists("conversations", "reasoning_content", "TEXT"); // Kimi K2 thinking round-trip
    ensureColumnExists("summaries", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("summaries", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("scratchpad", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("scratchpad", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("traces", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("reflections", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("playbook", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("playbook", "updated_at", "INTEGER NOT NULL DEFAULT (unixepoch())");
    ensureColumnExists("tool_cache", "created_at", "INTEGER NOT NULL DEFAULT (unixepoch())");

    // hive_capabilities: create if not exists (applied via CONTEXT_ENGINE_SCHEMA IF NOT EXISTS)
    // No column migrations needed — table is seeded fresh each startup via INSERT OR REPLACE

  // Data migrations: fix known bad base_url values from old seeds
  if (_db) {
    // Sync channels — vision columns for multimodal support
    ensureColumnExists("channels", "vision_enabled", "INTEGER NOT NULL DEFAULT 0");
    ensureColumnExists("channels", "ocr_provider", "TEXT");
    ensureColumnExists("channels", "vision_provider", "TEXT");
    ensureColumnExists("channels", "vision_model_id", "TEXT");

    _db.query(`UPDATE providers SET base_url = 'https://api.groq.com/openai/v1' WHERE id = 'groq' AND base_url = 'https://api.groq.com/v1'`).run();
        _db.query(`UPDATE providers SET base_url = 'https://api.openai.com/v1' WHERE id = 'openai' AND base_url = 'https://api.openai.com'`).run();
        // Fix Gemini base_url: the @google/genai SDK already knows the correct URL internally.
        // Passing /v1beta as baseUrl causes it to double-append the path → 404.
        _db.query(`UPDATE providers SET base_url = NULL WHERE id = 'gemini' AND base_url = 'https://generativelanguage.googleapis.com/v1beta'`).run();
    }
}


export class DatabaseService {
    private log = logger.child("sqlite");

    private get db(): Database {
        if (!_db) {
            initializeDatabase();
        }
        return _db!;
    }

    public close(): void {
        if (_db) {
            _db.close();
            _db = null;
        }
    }

    public updateMCPServer(id: string, updates: any): void {
        const fields = [];
        const values: any = { $id: id };

        if (updates.enabled !== undefined) {
            fields.push("enabled = $enabled");
            values.$enabled = updates.enabled ? 1 : 0;
        }
        if (updates.active !== undefined) {
            fields.push("active = $active");
            values.$active = updates.active ? 1 : 0;
        }
        if (updates.status !== undefined) {
            fields.push("status = $status");
            values.$status = updates.status;
        }
        if (updates.tools_count !== undefined) {
            fields.push("tools_count = $tools_count");
            values.$tools_count = updates.tools_count;
        }
        if (updates.transport !== undefined) {
            fields.push("transport = $transport");
            values.$transport = updates.transport;
        }
        if (updates.command !== undefined) {
            fields.push("command = $command");
            values.$command = updates.command;
        }
        if (updates.args !== undefined) {
            fields.push("args = $args");
            values.$args = JSON.stringify(updates.args);
        }
        if (updates.url !== undefined) {
            fields.push("url = $url");
            values.$url = updates.url;
        }
        if (updates.env_encrypted !== undefined) {
            fields.push("env_encrypted = $env_encrypted");
            values.$env_encrypted = updates.env_encrypted;
        }
        if (updates.env_iv !== undefined) {
            fields.push("env_iv = $env_iv");
            values.$env_iv = updates.env_iv;
        }
        if (updates.headers_encrypted !== undefined) {
            fields.push("headers_encrypted = $headers_encrypted");
            values.$headers_encrypted = updates.headers_encrypted;
        }
        if (updates.headers_iv !== undefined) {
            fields.push("headers_iv = $headers_iv");
            values.$headers_iv = updates.headers_iv;
        }

        if (fields.length === 0) return;

        const query = `UPDATE mcp_servers SET ${fields.join(", ")} WHERE id = $id`;
        try {
            this.db.query(query).run(values);
            this.log.debug(`MCP server ${id} updated in DB`);
        } catch (error: any) {
            this.log.error(`Failed to update MCP server ${id}: ${error.message}`);
        }
    }

    public getActiveAgentWorkspace(): string | null {
        try {
            const row = this.db.query(
                "SELECT workspace FROM agents WHERE role = 'coordinator' LIMIT 1"
            ).get() as { workspace: string } | null;
            const ws = row?.workspace;
            return ws && ws !== "null" ? ws : null;
        } catch {
            return null;
        }
    }

    public listMCPServers(): any[] {
        try {
            return this.db.query("SELECT * FROM mcp_servers").all();
        } catch (error: any) {
            this.log.error(`Failed to list MCP servers: ${error.message}`);
            return [];
        }
    }

    public createTask(task: {
        project_id: string;
        agent_id?: string | null;
        parent_task_id?: number | null;
        name: string;
        description?: string | null;
    }): number {
        const result = this.db.query(`
            INSERT INTO tasks (project_id, agent_id, parent_task_id, name, description)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            task.project_id,
            task.agent_id ?? null,
            task.parent_task_id ?? null,
            task.name,
            task.description ?? null
        );
        return Number(result.lastInsertRowid);
    }

    public updateTask(taskId: number, updates: {
        status?: string;
        progress?: number;
        result?: string;
        agent_id?: string | null;
    }): boolean {
        const fields: string[] = ["updated_at = unixepoch()"];
        const values: any[] = [];

        if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
        if (updates.progress !== undefined) { fields.push("progress = ?"); values.push(updates.progress); }
        if (updates.result !== undefined) { fields.push("result = ?"); values.push(updates.result); }
        if (updates.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(updates.agent_id); }

        values.push(taskId);
        const res = this.db.query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
        return res.changes > 0;
    }

    public getTasksByProject(projectId: string): any[] {
        return this.db.query(
            "SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC"
        ).all(projectId) as any[];
    }

    public getProjectWithTasks(projectId: string): any | null {
        const project = this.db.query("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
        if (!project) return null;
        project.tasks = this.getTasksByProject(projectId);
        return project;
    }

    public recalcProjectProgress(projectId: string): number {
        const row = this.db.query(
            "SELECT AVG(progress) as avg_progress FROM tasks WHERE project_id = ?"
        ).get(projectId) as any;
        const avg = Math.round(row?.avg_progress ?? 0);
        this.db.query("UPDATE projects SET progress = ?, updated_at = unixepoch() WHERE id = ?").run(avg, projectId);
        return avg;
    }

    public saveMCPServer(server: any): void {
        try {
            this.db.query(`
                INSERT OR REPLACE INTO mcp_servers (id, name, transport, command, args, url, env_encrypted, env_iv, headers_encrypted, headers_iv, enabled, active, builtin, tools_count, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                server.id || server.name,
                server.name,
                server.transport,
                server.command || null,
                JSON.stringify(server.args || []),
                server.url || null,
                server.env_encrypted || null,
                server.env_iv || null,
                server.headers_encrypted || null,
                server.headers_iv || null,
                server.enabled ? 1 : 0,
                server.active ? 1 : 0,
                server.builtin ? 1 : 0,
                server.tools_count || 0,
                server.status || "disconnected"
            );
        } catch (error: any) {
            this.log.error(`Failed to save MCP server ${server.name}: ${error.message}`);
        }
    }
}

export const dbService = new DatabaseService();
