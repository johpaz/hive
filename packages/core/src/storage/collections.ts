/**
 * Document shapes for every HiveDB collection. Kept in one place — with no
 * imports of its own — so any storage/route/agent module can import a type
 * without risking a circular import.
 *
 * Nullable FK-like fields that are also equality-indexed (`createIndex`)
 * store the {@link toIndexable}/{@link fromIndexable} sentinel (`__none__`)
 * instead of `null`, since `findBy`/`createIndex` don't accept `null`.
 */

// ─── Stage 1: identity/config core ───────────────────────────────────────────

export interface UserDoc {
  id: string
  name: string | null
  language: string | null
  timezone: string | null
  occupation: string | null
  notes: string | null
  master_key_hash: string | null
  email: string | null
  password_hash: string | null
  preferred_cron_channel: string
  created_at: number
}

export interface ProviderDoc {
  id: string
  name: string
  base_url: string | null
  category: "llm" | "stt" | "tts"
  num_ctx: number | null
  num_gpu: number
  enabled: boolean
  active: boolean
  created_at: number
}

export interface ModelDoc {
  id: string
  provider_id: string
  name: string
  model_type: "llm" | "stt" | "tts" | "vision" | "embedding"
  context_window: number
  capabilities: string | null
  enabled: boolean
  active: boolean
}

export interface AgentDoc {
  id: string
  user_id: string
  name: string
  description: string | null
  system_prompt: string | null
  tone: string | null
  role: "coordinator" | "worker"
  status: string
  enabled: boolean
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  provider_id: string
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  model_id: string
  tools_json: string | null
  skills_json: string | null
  /** `toIndexable`-encoded — `NO_PARENT` for the coordinator. */
  parent_id: string
  max_iterations: number
  workspace: string | null
  /** Denormalized from `traces` — last time this agent produced a trace. */
  lastTraceAt: number | null
  created_at: number
  updated_at: number
}

// ─── Stage 2: catalog ─────────────────────────────────────────────────────────

export interface ChannelDoc {
  id: string
  /** `toIndexable`-encoded — `NO_PARENT` for global (unowned) channels. */
  user_id: string
  type: string
  enabled: boolean
  active: boolean
  status: string
  last_active: number | null
  voice_enabled: boolean
  tts_enabled: boolean
  stt_provider: string | null
  tts_provider: string | null
  tts_voice_id: string | null
  step_delivery_mode: string
  vision_enabled: boolean
  ocr_provider: string | null
  vision_provider: string | null
  vision_model_id: string | null
}

export interface McpServerDoc {
  id: string
  name: string
  transport: string
  command: string | null
  args: string | null
  url: string | null
  enabled: boolean
  active: boolean
  builtin: boolean
  status: string
  tools_count: number
  /** Present only for user-created (non-builtin) servers, e.g. `"<userId>:<name>"` ids. */
  user_id?: string
}

export interface SkillDoc {
  id: string
  name: string
  description: string | null
  version: string
  author: string
  icon: string
  category: string
  permissions: string
  dependencies: string
  tools: string
  triggers: string
  preferred_agents: string
  body: string
  version_num: number
  active: boolean
  created_at: number
  updated_at: number
}

export interface ToolDoc {
  id: string
  name: string
  description: string | null
  category: string | null
  enabled: boolean
  active: boolean
  created_at: number
  updated_at: number
}

export interface EthicsDoc {
  id: string
  name: string
  description: string | null
  content: string
  is_default: boolean
  enabled: boolean
  active: boolean
}

export interface McpToolDoc {
  id: string
  server_id: string
  server_name: string
  tool_name: string
  description: string | null
  category: string | null
  active: boolean
}

// ─── Stage 3: auth/identity ───────────────────────────────────────────────────

export interface UserIdentityDoc {
  user_id: string
  channel: string
  channel_user_id: string
  linked_at: number
}

export interface UserChannelDoc {
  id: string
  user_id: string
  channel: string
  account_id: string
  config: string
  active: boolean
}

export interface OnboardingProgressDoc {
  user_id: string
  step: string
  data: string
}

export interface RefreshTokenDoc {
  id: string
  user_id: string
  token_hash: string
  expires_at: number
  revoked: boolean
}

// ─── Stage 4: chat/ACE ────────────────────────────────────────────────────────

export interface ConversationDoc {
  id: string
  thread_id: string
  channel: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  content_multimodal: string | null
  tool_calls_json: string | null
  tool_call_id: string | null
  reasoning_content: string | null
  token_count: number
  created_at: number
  updated_at: number
}

export interface SummaryDoc {
  thread_id: string
  summary: string
  messages_covered: number
  last_message_id: string | null
}

export interface TraceDoc {
  id: string
  thread_id: string
  agent_id: string
  agent_name: string
  tool_used: string | null
  input_summary: string
  output_summary: string
  success: boolean
  error_message: string | null
  duration_ms: number | null
  tokens_used: number | null
  created_at: number
}

export interface ReflectionDoc {
  id: string
  trace_ids: string
  insight_type: "success_pattern" | "failure_pattern" | "optimization" | "ethics_violation"
  description: string
  affected_tools: string | null
  affected_agents: string | null
  confidence: number
  created_at: number
}

export interface PlaybookDoc {
  id: string
  rule: string
  category: string
  applicable_to: string | null
  helpful_count: number
  harmful_count: number
  active: boolean
  /** `toIndexable`-encoded — `NO_PARENT` when not derived from a reflection. */
  source_reflection_id: string
  created_at: number
  updated_at: number
}

export interface CursorDoc {
  value: string
}

// ─── Stage 5: scheduler ───────────────────────────────────────────────────────

export interface AgentRunDoc {
  id: string
  thread_id: string
  agent_id: string
  user_id: string
  channel: string | null
  kind: "chat" | "worker" | "goal" | "cron" | "project"
  status: "running" | "completed" | "failed" | "interrupted" | "aborted"

  iterations_used: number
  max_iterations: number
  turns_used: number
  max_turns: number | null
  tokens_used: number
  max_tokens: number | null

  goal: string | null
  goal_check_tool: string | null
  goal_attempts: number

  state_json: string
  state_bytes: number
  pending_tool_calls_json: string | null
  checkpointed_at: number

  boot_id: string
  lease_expires_at: number
  resume_policy: "resume" | "mark_interrupted" | "discard"

  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

export interface JobDoc {
  id: string
  lane: string
  type: "chat_turn" | "worker_task" | "project_task" | "goal_run"
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  priority: number
  payload_json: string
  run_id: string
  attempts: number
  max_attempts: number
  not_before: number
  boot_id: string | null
  lease_expires_at: number | null
  result_json: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
}

export interface CronJobDoc {
  id: string
  name: string
  task: string
  task_type: "recurring" | "one_shot"
  cron_expression: string | null
  fire_at: string | null
  timezone: string
  start_at: string | null
  stop_at: string | null
  dom_and_dow: number
  max_runs: number | null
  protect: number
  interval_sec: number | null
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  agent_id: string
  channel: string
  payload: string
  tool_name: string | null
  status: "active" | "paused" | "completed" | "failed" | "cancelled"
  run_count: number
  error_count: number
  last_error: string | null
  misfire_policy?: "skip" | "fire_once"
  misfire_grace_min?: number
  created_at: string
  updated_at: string
  last_run_at: string | null
  next_run_at: string | null
  completed_at: string | null
}

export interface TaskRunDoc {
  id: string
  task_id: string
  status: "running" | "success" | "failed" | "timeout"
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_message: string | null
  payload_snapshot: string | null
  agent_response: string | null
}

// ─── Stage 6: orchestration ───────────────────────────────────────────────────

/** id = title — the old `notes`/`memory_*` table never existed, so this is a from-scratch fix. */
export interface MemoryDoc {
  id: string
  title: string
  content: string
  created_at: number
  updated_at: number
}

export interface ProjectDoc {
  id: string
  user_id: string
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  agent_id: string
  name: string
  description: string | null
  type: string
  task: string | null
  progress: number
  status: "pending" | "active" | "paused" | "done" | "failed"
  context: string | null
  /** `toIndexable`-encoded — `NO_PARENT` for a top-level project. */
  parent_id: string
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
}

export interface TaskDoc {
  id: string
  project_id: string
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  agent_id: string
  parent_task_id: string | null
  name: string
  description: string | null
  /** "queued" = claimed by the TaskDriver and enqueued, awaiting execution. */
  status: "pending" | "queued" | "in_progress" | "completed" | "failed" | "blocked"
  progress: number
  priority: number
  depends_on: string | null
  result: string | null
  error: string | null
  metadata: string | null
  job_id: string | null
  run_id: string | null
  thread_id: string | null
  started_at: number | null
  attempts: number
  created_at: number
  updated_at: number
  completed_at: number | null
}

export interface AgentBusMessageDoc {
  id: string
  event_type: string
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  from_worker_id: string
  /** `toIndexable`-encoded — `BROADCAST` (`"*"`) for broadcast messages. */
  to_worker_id: string
  topic: string | null
  content: string
  metadata: string | null
  read: boolean
  created_at: number
}

// ─── Stage 7: meeting ─────────────────────────────────────────────────────────

export interface MeetingSessionDoc {
  id: string
  /** `toIndexable`-encoded — `NO_PARENT` when unset. */
  user_id: string
  title: string
  status: "active" | "stopped" | "report_ready"
  stt_model: string
  started_at: number
  stopped_at: number | null
  report_path: string | null
  metadata: string | null
}

export interface MeetingSegmentDoc {
  id: string
  session_id: string
  seq: number
  speaker: string | null
  text: string
  duration_ms: number | null
  created_at: number
}

// ─── Stage 8: usage/stats ─────────────────────────────────────────────────────

/** id = global counter (`nextId("usageRecords")`) — sortable, so "recent records" is a cheap reverse scan. */
export interface UsageRecordDoc {
  id: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  latency_ms: number | null
  toon_saved_tokens: number
  toon_saved_cost: number
  toon_json_bytes: number
  toon_toon_bytes: number
  toon_saved_bytes: number
  toon_saved_percent: number
  toon_json_tokens: number
  toon_toon_tokens: number
  toon_saved_tokens_pct: number
  created_at: number
}

export interface UsageRollupDoc {
  inputTokens: number
  outputTokens: number
  costUsd: number
  toonSavedTokens: number
  toonSavedCost: number
  toonSavedBytes: number
  toonJsonTokens: number
  toonToonTokens: number
  toonJsonBytes: number
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>
  byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>
}

export interface ActivityRollupDoc {
  messageCount: number
}
