import { z } from "zod";

// ─── Agent Roles ────────────────────────────────────────────────────────────

export const AgentRole = z.enum([
    "architecture",
    "development",
    "testing",
    "documentation",
]);
export type AgentRole = z.infer<typeof AgentRole>;

// ─── Subagent Configuration ──────────────────────────────────────────────────

export const SubagentConfig = z.object({
    role: AgentRole,
    /** The CLI tool to use for this role (e.g. "opencode", "gemini", "qwen") */
    cli: z.string(),
    /** Extra args to pass to the CLI tool */
    args: z.array(z.string()).default([]),
    /** Working directory override. Defaults to monorepo root. */
    cwd: z.string().optional(),
    /** Max wallclock seconds before the process is auto-killed */
    timeoutSeconds: z.number().default(600),
});
export type SubagentConfig = z.infer<typeof SubagentConfig>;

// ─── Telemetry event shapes sent over the local WebSocket mesh ──────────────

export const TelemetryEventType = z.enum([
    "agent:started",
    "agent:output",      // stdout/stderr chunk
    "agent:progress",    // 0-100 progress hint emitted by the CLI tool
    "agent:token_usage", // token counters
    "agent:finished",
    "agent:error",
    "agent:cancelled",
    "code-bridge:status",
]);
export type TelemetryEventType = z.infer<typeof TelemetryEventType>;

const BaseEvent = z.object({
    ts: z.number().default(() => Date.now()),
    role: AgentRole,
});

export const AgentStartedEvent = BaseEvent.extend({
    type: z.literal("agent:started"),
    pid: z.number(),
    cli: z.string(),
    taskId: z.string(),
});

export const AgentOutputEvent = BaseEvent.extend({
    type: z.literal("agent:output"),
    taskId: z.string(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
});

export const AgentProgressEvent = BaseEvent.extend({
    type: z.literal("agent:progress"),
    taskId: z.string(),
    percent: z.number().min(0).max(100),
});

export const AgentTokenUsageEvent = BaseEvent.extend({
    type: z.literal("agent:token_usage"),
    taskId: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    model: z.string(),
});

export const AgentFinishedEvent = BaseEvent.extend({
    type: z.literal("agent:finished"),
    taskId: z.string(),
    exitCode: z.number(),
});

export const AgentErrorEvent = BaseEvent.extend({
    type: z.literal("agent:error"),
    taskId: z.string(),
    message: z.string(),
});

export const AgentCancelledEvent = BaseEvent.extend({
    type: z.literal("agent:cancelled"),
    taskId: z.string(),
});

export const CodeBridgeStatusEvent = z.object({
    type: z.literal("code-bridge:status"),
    ts: z.number().default(() => Date.now()),
    agents: z.array(
        z.object({
            taskId: z.string(),
            role: AgentRole,
            cli: z.string(),
            pid: z.number(),
            state: z.enum(["running", "finished", "cancelled", "error"]),
            progress: z.number(),
            tokens: z.object({ input: z.number(), output: z.number() }),
            model: z.string().optional(),
        })
    ),
});

export const TelemetryEvent = z.discriminatedUnion("type", [
    AgentStartedEvent,
    AgentOutputEvent,
    AgentProgressEvent,
    AgentTokenUsageEvent,
    AgentFinishedEvent,
    AgentErrorEvent,
    AgentCancelledEvent,
    CodeBridgeStatusEvent,
]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

// ─── Dashboard → Code Bridge commands ──────────────────────────────────────

export const DashboardCommand = z.discriminatedUnion("cmd", [
    z.object({
        cmd: z.literal("launch"),
        config: SubagentConfig,
        taskId: z.string(),
        prompt: z.string(),
    }),
    z.object({ cmd: z.literal("cancel"), taskId: z.string() }),
    z.object({ cmd: z.literal("status") }),
    z.object({ cmd: z.literal("ping") }),
]);
export type DashboardCommand = z.infer<typeof DashboardCommand>;
