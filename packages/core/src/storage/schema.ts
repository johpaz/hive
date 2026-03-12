export const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- ENCRYPTION KEY (stored separately, used for encrypting sensitive data)
  -- The encryption key is derived from HIVE_MASTER_KEY env var or generated on first run
  
  -- CONFIGURATION (all linked to user)

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT,
    language        TEXT,
    timezone        TEXT,
    occupation      TEXT,
    notes           TEXT,
    master_key_hash TEXT,
    preferred_cron_channel TEXT NOT NULL DEFAULT 'auto',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Providers: linked to user (API key encrypted)
  -- Solo la empresa (OpenAI, Groq, ElevenLabs, etc.)
  -- La API key es del provider, no del modelo
  -- category: 'llm', 'stt', 'tts' (default: llm)
  CREATE TABLE IF NOT EXISTS providers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    api_key_encrypted TEXT,
    api_key_iv      TEXT,
    headers_encrypted TEXT,
    headers_iv      TEXT,
    base_url        TEXT,
    category        TEXT NOT NULL DEFAULT 'llm',
    num_ctx         INTEGER,
    num_gpu         INTEGER DEFAULT -1,
    enabled         INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Models: linked to provider
  -- model_type: 'llm', 'stt', 'tts', 'vision', 'embedding'
  -- stt models: whisper-1, whisper-large-v3
  -- tts models: tts-1, gpt-4o-mini-tts, eleven_multilingual_v2
  CREATE TABLE IF NOT EXISTS models (
    id              TEXT PRIMARY KEY,
    provider_id     TEXT REFERENCES providers(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    model_type      TEXT NOT NULL DEFAULT 'llm',
    context_window  INTEGER NOT NULL DEFAULT 20000,
    capabilities    TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 0
  );

  -- Agents: linked to user + provider/model
  -- role: 'coordinator' | 'worker'
  -- system_prompt: explicit prompt (description is a human-readable summary)
  -- tools_json: JSON array of tool IDs this agent can use (NULL = all)
  -- skills_json: JSON array of skill IDs this agent can use (NULL = all)
  -- parent_id: agent that created this one (NULL for coordinator)
  -- max_iterations: loop limit per invocation
  CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    system_prompt   TEXT,
    tone            TEXT,
    role            TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator', 'worker')),
    status          TEXT NOT NULL DEFAULT 'idle',
    enabled         INTEGER NOT NULL DEFAULT 1,
    provider_id     TEXT REFERENCES providers(id),
    model_id        TEXT REFERENCES models(id),
    tools_json      TEXT,
    skills_json     TEXT,
    parent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
    max_iterations  INTEGER NOT NULL DEFAULT 10,
    headers_encrypted TEXT,
    headers_iv      TEXT,
    workspace       TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Channels: linked to user (or global if user_id is NULL)
  -- voice_enabled: enables speech-to-text for incoming audio
  -- tts_enabled: enables text-to-speech for outgoing responses
  -- stt_provider: which STT provider to use (groq-whisper, openai-whisper)
  -- tts_provider: which TTS provider to use (elevenlabs, openai-tts)
  -- tts_voice_id: specific voice ID for TTS (e.g., ElevenLabs voice ID)
  -- step_delivery_mode: how to send intermediate steps to user:
  --   "new_message" = send new message for each step (default)
  --   "edit" = edit same message (Telegram/Discord only)
  --   "thread" = use threading (Slack only)
  CREATE TABLE IF NOT EXISTS channels (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    config_encrypted TEXT,
    config_iv   TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'disconnected',
    last_active INTEGER,
    voice_enabled INTEGER NOT NULL DEFAULT 0,
    tts_enabled INTEGER NOT NULL DEFAULT 0,
    stt_provider TEXT,
    tts_provider TEXT,
    tts_voice_id TEXT,
    step_delivery_mode TEXT DEFAULT 'new_messages'
  );

  -- MCP Servers: linked to user (or global if user_id is NULL)
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    transport   TEXT NOT NULL,
    command     TEXT,
    args        TEXT,
    env_encrypted TEXT,
    env_iv      TEXT,
    headers_encrypted TEXT,
    headers_iv  TEXT,
    url         TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 0,
    builtin     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'disconnected',
    tools_count INTEGER DEFAULT 0
  );

  -- MCP Servers: external tool providers (stdio, SSE, etc.)
  -- MCP tools are loaded at runtime from connected servers, not stored in DB
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    transport   TEXT NOT NULL,
    command     TEXT,
    args        TEXT,
    env_encrypted TEXT,
    env_iv      TEXT,
    headers_encrypted TEXT,
    headers_iv  TEXT,
    url         TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 0,
    builtin     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'disconnected',
    tools_count INTEGER DEFAULT 0
  );

  -- Note: MCP tools are NOT stored in DB. They are loaded from MCP servers at runtime
  -- and made available directly via context-compiler (Direct Connection architecture)

  -- Skills: can be global (system) or user-specific
  -- Simplified schema with body field for markdown content
  CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,        -- 'web_research'
    name        TEXT NOT NULL,           -- 'Web Research'
    category    TEXT NOT NULL,           -- 'web'
    tools       TEXT NOT NULL,           -- 'web_search,web_fetch'
    triggers    TEXT NOT NULL,           -- 'investiga,busca,research'
    body        TEXT NOT NULL,           -- Markdown completo
    version     INTEGER DEFAULT 1,
    active      INTEGER DEFAULT 1,       -- 1=activo, 0=desactivado
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- Índices para filtros directos
  CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
  CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(active);

  -- Tools: global (bundled), not user-specific
  -- category: 'bundled', 'workspace', 'project', 'builtin', 'voice'
  CREATE TABLE IF NOT EXISTS tools (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    category    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Ethics: global templates (user selects one)
  CREATE TABLE IF NOT EXISTS ethics (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    content         TEXT NOT NULL,
    is_default      INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 0
  );

  -- Code Bridge: external CLI tools configuration (global)
  CREATE TABLE IF NOT EXISTS code_bridge (
    id              TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL UNIQUE,
    cli_command     TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 0,
    port            INTEGER DEFAULT 18791,
    config          TEXT
  );

  -- Code Bridge Config: key-value store for configuration (voice_wake_word, etc.)
  CREATE TABLE IF NOT EXISTS code_bridge_config (
    id              TEXT PRIMARY KEY,
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    value           TEXT,
    UNIQUE(user_id, key)
  );

  -- USER IDENTITIES (channel + user mapping)

  CREATE TABLE IF NOT EXISTS user_identities (
    user_id         TEXT NOT NULL REFERENCES users(id),
    channel         TEXT NOT NULL,
    channel_user_id TEXT NOT NULL,
    linked_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, channel)
  );

  -- USER CHANNELS (user-specific channel configurations)
  -- Stores per-user channel account configurations (Telegram bot, Discord bot, etc.)
  -- config: JSON object with channel-specific settings (bot token, webhook URL, etc.)
  -- active: 1 = enabled and running, 0 = disabled
  CREATE TABLE IF NOT EXISTS user_channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    config      TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, channel, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channels(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel);

  -- ONBOARDING PROGRESS

  CREATE TABLE IF NOT EXISTS onboarding_progress (
    id        TEXT PRIMARY KEY,
    user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
    step      TEXT NOT NULL,
    data      TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- USAGE TRACKING (tokens, costs)
  CREATE TABLE IF NOT EXISTS usage_records (
    id            TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    latency_ms    INTEGER,
    toon_saved_tokens INTEGER NOT NULL DEFAULT 0,
    toon_saved_cost   REAL NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- CRON JOBS: scheduled tasks with notification channel
  -- notify_channel_id: which channel to send notifications to when task runs
  -- max_runs: NULL = unlimited; auto-disables when run_count reaches max_runs
  -- expires_at: NULL = never expires; auto-disables after this UTC timestamp
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    task_type       TEXT NOT NULL DEFAULT 'message',
    task_config     TEXT,
    notify_channel_id TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    max_runs        INTEGER,
    run_count       INTEGER NOT NULL DEFAULT 0,
    expires_at      INTEGER,
    last_run        INTEGER,
    next_run        INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- INDICES

  CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);
  CREATE INDEX IF NOT EXISTS idx_models_type     ON models(model_type);
  CREATE INDEX IF NOT EXISTS idx_agents_user    ON agents(user_id);
  CREATE INDEX IF NOT EXISTS idx_channels_user  ON channels(user_id);
  CREATE INDEX IF NOT EXISTS idx_channels_type  ON channels(type);
  CREATE INDEX IF NOT EXISTS idx_ethics        ON ethics(id);
  CREATE INDEX IF NOT EXISTS idx_code_bridge   ON code_bridge(id);
  CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
  CREATE INDEX IF NOT EXISTS idx_usage_provider_model ON usage_records(provider, model);
  CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_records(created_at);
  CREATE INDEX IF NOT EXISTS idx_code_bridge_config_user ON code_bridge_config(user_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run);
`;

export const PROJECTS_SCHEMA = `
  -- PROJECTS: tareas multi-paso con seguimiento de progreso
  CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL DEFAULT 'general',
    task            TEXT,
    progress        INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','paused','done','failed')),
    context         TEXT,
    parent_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    started_at      INTEGER,
    completed_at    INTEGER
  );

  -- TASKS: subtareas atómicas asociadas a un proyecto, con agente asignado
  -- depends_on: JSON array of task IDs that must complete before this one
  -- priority: higher = more urgent
  -- error: reason for failure if status='failed'
  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
    parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed','blocked')),
    progress        INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    priority        INTEGER NOT NULL DEFAULT 0,
    depends_on      TEXT,
    result          TEXT,
    error           TEXT,
    metadata        TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_projects_agent ON projects(agent_id);
  CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
`;

// ─── Context Engine + ACE tables ─────────────────────────────────────────────

export const CONTEXT_ENGINE_SCHEMA = `
  -- CONVERSATIONS: full message history per thread (replaces lg_checkpoints)
  -- role: 'user' | 'assistant' | 'tool' | 'system'
  -- tool_calls_json: JSON array of tool calls if the message triggered any
  -- token_count: estimated tokens for context budget tracking
  CREATE TABLE IF NOT EXISTS conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       TEXT NOT NULL,
    channel         TEXT NOT NULL DEFAULT 'webchat',
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
    content         TEXT NOT NULL,
    tool_calls_json TEXT,
    tool_call_id    TEXT,
    token_count     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- SUMMARIES: compressed digests of long conversations
  -- The Context Compiler uses the summary instead of full history
  CREATE TABLE IF NOT EXISTS summaries (
    thread_id         TEXT PRIMARY KEY,
    summary           TEXT NOT NULL,
    messages_covered  INTEGER NOT NULL DEFAULT 0,
    last_message_id   INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- SCRATCHPAD: persistent key-value notes per conversation
  -- Survives context compression. Written by agents via save_note tool.
  CREATE TABLE IF NOT EXISTS scratchpad (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    source      TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(thread_id, key)
  );

  -- TRACES: execution log for every agent invocation (ACE Generator output)
  -- success: 1 = ok, 0 = failure
  -- tokens_used: total tokens consumed in this invocation
  CREATE TABLE IF NOT EXISTS traces (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       TEXT NOT NULL,
    agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    agent_name      TEXT NOT NULL,
    tool_used       TEXT,
    input_summary   TEXT NOT NULL,
    output_summary  TEXT NOT NULL,
    success         INTEGER NOT NULL DEFAULT 1,
    error_message   TEXT,
    duration_ms     INTEGER,
    tokens_used     INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- REFLECTIONS: insights extracted by the ACE Reflector from traces
  -- insight_type: 'success_pattern' | 'failure_pattern' | 'optimization' | 'ethics_violation'
  -- confidence: 0.0 to 1.0
  CREATE TABLE IF NOT EXISTS reflections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_ids       TEXT NOT NULL,
    insight_type    TEXT NOT NULL CHECK(insight_type IN ('success_pattern','failure_pattern','optimization','ethics_violation')),
    description     TEXT NOT NULL,
    affected_tools  TEXT,
    affected_agents TEXT,
    confidence      REAL NOT NULL DEFAULT 0.5,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- PLAYBOOK: evolved rules injected by Context Compiler (ACE Curator output)
  -- category: 'tool_selection' | 'response_quality' | 'error_avoidance' | 'optimization' | 'agent_creation'
  -- applicable_to: JSON array of contexts where this rule applies
  -- helpful_count / harmful_count: feedback from execution outcomes
  -- active: 0 = pruned by Curator
  CREATE TABLE IF NOT EXISTS playbook (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    rule                  TEXT NOT NULL,
    category              TEXT NOT NULL CHECK(category IN ('tool_selection','response_quality','error_avoidance','optimization','agent_creation')),
    applicable_to         TEXT,
    helpful_count         INTEGER NOT NULL DEFAULT 0,
    harmful_count         INTEGER NOT NULL DEFAULT 0,
    source_reflection_id  INTEGER REFERENCES reflections(id) ON DELETE SET NULL,
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- TOOL_CACHE: cached results for deterministic/expensive tool calls
  -- cache_key: hash of tool_id + serialized params
  -- ttl_seconds: 0 = no expiry
  CREATE TABLE IF NOT EXISTS tool_cache (
    cache_key   TEXT PRIMARY KEY,
    tool_id     TEXT NOT NULL,
    result      TEXT NOT NULL,
    ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- FTS5 indexes for fast semantic search in Context Compiler
  -- Created by initializeDatabase() via CONTEXT_ENGINE_SCHEMA
  -- Populated by syncToolsToFTS() and syncSkillsToFTS() from gateway/initializer.ts
  -- Triggers are NOT used - data is cleared and re-inserted on each sync to avoid schema drift

  CREATE VIRTUAL TABLE IF NOT EXISTS playbook_fts USING fts5(
    rule,
    category,
    applicable_to
  );

  -- FTS5: tool catalog search (populated by syncToolCatalogToFTS from gateway/initializer.ts)
  CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(
    tool_name,
    name,
    description,
    category
  );

  -- FTS5: skills catalog search (populated by syncSkillsToFTS from gateway/initializer.ts)
  -- Simplified schema - standalone FTS5 table (no content table sync)
  -- Note: FTS5 tables are created programmatically in seed.ts to avoid "already exists" errors

  -- Agent Bus: Message queue for worker-to-worker communication
  CREATE TABLE IF NOT EXISTS agent_bus_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT NOT NULL,
    from_worker_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
    to_worker_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
    topic           TEXT,
    content         TEXT NOT NULL,
    metadata        TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    read            INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_agent_bus_from_worker ON agent_bus_messages(from_worker_id);
  CREATE INDEX IF NOT EXISTS idx_agent_bus_to_worker ON agent_bus_messages(to_worker_id);
  CREATE INDEX IF NOT EXISTS idx_agent_bus_event_type ON agent_bus_messages(event_type);
  CREATE INDEX IF NOT EXISTS idx_agent_bus_read ON agent_bus_messages(read);

  -- INDICES
  CREATE INDEX IF NOT EXISTS idx_conversations_thread ON conversations(thread_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_role   ON conversations(role);
  CREATE INDEX IF NOT EXISTS idx_scratchpad_thread    ON scratchpad(thread_id);
  CREATE INDEX IF NOT EXISTS idx_traces_thread        ON traces(thread_id);
  CREATE INDEX IF NOT EXISTS idx_traces_agent         ON traces(agent_id);
  CREATE INDEX IF NOT EXISTS idx_traces_success       ON traces(success);
  CREATE INDEX IF NOT EXISTS idx_reflections_type     ON reflections(insight_type);
  CREATE INDEX IF NOT EXISTS idx_playbook_active      ON playbook(active);
  CREATE INDEX IF NOT EXISTS idx_playbook_category    ON playbook(category);
  CREATE INDEX IF NOT EXISTS idx_tool_cache_tool      ON tool_cache(tool_id);


`;
