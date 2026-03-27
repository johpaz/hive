import type { ServerWebSocket } from "bun";
import type { SubagentConfig, TelemetryEvent } from "./schemas.ts";
import { AgentRole } from "./schemas.ts";
import {
    getCliConfig,
    buildCliArgs,
    validateCliEnv,
    getCliTimeout,
    requiresStdinClose,
} from "./cli-configs.ts";

/** Live record of a running subagent process */
interface AgentRecord {
    taskId: string;
    config: SubagentConfig;
    pid: number;
    proc: ReturnType<typeof Bun.spawn>;
    state: "running" | "finished" | "cancelled" | "error";
    progress: number;
    tokens: { input: number; output: number };
    model?: string;
    startedAt: number;
}

type WsData = { id: string };

export class ProcessManager {
    private agents = new Map<string, AgentRecord>();
    private sockets = new Set<ServerWebSocket<WsData>>();

    // ── Socket subscription ──────────────────────────────────────────────────

    subscribe(ws: ServerWebSocket<WsData>) {
        this.sockets.add(ws);
    }

    unsubscribe(ws: ServerWebSocket<WsData>) {
        this.sockets.delete(ws);
    }

    private broadcast(event: TelemetryEvent) {
        const payload = JSON.stringify(event);
        for (const ws of this.sockets) {
            try {
                ws.send(payload);
            } catch {
                this.sockets.delete(ws);
            }
        }
    }

    // ── Launch ───────────────────────────────────────────────────────────────

    async launch(taskId: string, config: SubagentConfig, prompt: string) {
        if (this.agents.has(taskId)) {
            throw new Error(`Task ${taskId} is already running`);
        }

        // Get CLI-specific configuration
        const cliConfig = getCliConfig(config.cli);
        
        // Validate environment variables
        const envValidation = validateCliEnv(config.cli);
        if (!envValidation.valid) {
            throw new Error(
                `Missing environment variables for ${config.cli}: ${envValidation.missing.join(", ")}`
            );
        }

        // Build command with CLI-specific args
        const cliArgs = buildCliArgs(config.cli, config.args);
        const args = [config.cli, ...cliArgs];  // Add CLI command at the beginning

        // Get effective timeout
        const timeoutSeconds = getCliTimeout(config.cli, config.timeoutSeconds);

        // Check if stdin should be closed after prompt
        const shouldCloseStdin = requiresStdinClose(config.cli);

        // For Qwen CLI, add prompt as -p argument instead of stdin
        const isQwen = config.cli === "qwen";
        if (isQwen && prompt) {
            args.push("-p", prompt);
        }

        const proc = Bun.spawn(args, {
            cwd: config.cwd ?? process.cwd(),
            stdin: isQwen ? "ignore" : "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: {
                ...process.env,
                HIVE_ROLE: config.role,
                // Add CLI-specific env vars if available
                ...(cliConfig?.envVars.reduce((acc, key) => {
                    if (process.env[key]) {
                        acc[key] = process.env[key]!;
                    }
                    return acc;
                }, {} as Record<string, string>) ?? {}),
            },
        });

        const record: AgentRecord = {
            taskId,
            config,
            pid: proc.pid,
            proc,
            state: "running",
            progress: 0,
            tokens: { input: 0, output: 0 },
            startedAt: Date.now(),
        };

        this.agents.set(taskId, record);

        this.broadcast({
            type: "agent:started",
            ts: Date.now(),
            role: config.role,
            pid: proc.pid,
            cli: config.cli,
            taskId,
        });

        // Write the prompt to stdin (only for non-Qwen CLIs)
        // Qwen CLI receives the prompt via -p argument
        if (!isQwen) {
            proc.stdin.write(prompt);

            // Close stdin only if this CLI requires it (e.g., Qwen)
            // Other CLIs may need stdin open for interactive features
            if (shouldCloseStdin) {
                proc.stdin.end();
            }
        }

        // Stream stdout
        this.pipeStream(record, proc.stdout, "stdout");
        // Stream stderr
        this.pipeStream(record, proc.stderr, "stderr");

        // Wait for process exit
        proc.exited.then((exitCode) => {
            const r = this.agents.get(taskId);
            if (!r || r.state === "cancelled") return;
            r.state = exitCode === 0 ? "finished" : "error";
            if (exitCode === 0) {
                this.broadcast({
                    type: "agent:finished",
                    ts: Date.now(),
                    role: config.role,
                    taskId,
                    exitCode,
                });
            } else {
                this.broadcast({
                    type: "agent:error",
                    ts: Date.now(),
                    role: config.role,
                    taskId,
                    message: `Process exited with code ${exitCode}`,
                });
            }
        });

        return record.pid;
    }

    // ── Cancel ───────────────────────────────────────────────────────────────

    cancel(taskId: string) {
        const record = this.agents.get(taskId);
        if (!record) return false;
        record.state = "cancelled";
        record.proc.kill();
        this.broadcast({
            type: "agent:cancelled",
            ts: Date.now(),
            role: record.config.role,
            taskId,
        });
        return true;
    }

    // ── Status snapshot ──────────────────────────────────────────────────────

    status(): TelemetryEvent {
        return {
            type: "code-bridge:status",
            ts: Date.now(),
            agents: [...this.agents.values()].map((r) => ({
                taskId: r.taskId,
                role: r.config.role,
                cli: r.config.cli,
                pid: r.pid,
                state: r.state,
                progress: r.progress,
                tokens: r.tokens,
                model: r.model,
            })),
        };
    }

    statusForTask(taskId: string) {
        const record = this.agents.get(taskId);
        if (!record) {
            return { found: false, taskId };
        }
        return {
            found: true,
            taskId: record.taskId,
            role: record.config.role,
            cli: record.config.cli,
            pid: record.pid,
            state: record.state,
            progress: record.progress,
            tokens: record.tokens,
            model: record.model,
            startedAt: record.startedAt,
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private async pipeStream(
        record: AgentRecord,
        stream: ReadableStream<Uint8Array>,
        kind: "stdout" | "stderr"
    ) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);

                // Parse progress hints: lines containing "HIVE_PROGRESS:<n>"
                for (const line of chunk.split("\n")) {
                    const m = line.match(/HIVE_PROGRESS:(\d+)/);
                    if (m) {
                        record.progress = Math.min(100, parseInt(m[1], 10));
                        this.broadcast({
                            type: "agent:progress",
                            ts: Date.now(),
                            role: record.config.role,
                            taskId: record.taskId,
                            percent: record.progress,
                        });
                    }
                    // Parse token hints: "HIVE_TOKENS:input=<n>,output=<n>,model=<name>"
                    const t = line.match(/HIVE_TOKENS:input=(\d+),output=(\d+)(?:,model=(.+))?/);
                    if (t) {
                        record.tokens = { input: parseInt(t[1], 10), output: parseInt(t[2], 10) };
                        if (t[3]) record.model = t[3].trim();
                        this.broadcast({
                            type: "agent:token_usage",
                            ts: Date.now(),
                            role: record.config.role,
                            taskId: record.taskId,
                            inputTokens: record.tokens.input,
                            outputTokens: record.tokens.output,
                            model: record.model ?? "unknown",
                        });
                    }
                }

                this.broadcast({
                    type: "agent:output",
                    ts: Date.now(),
                    role: record.config.role,
                    taskId: record.taskId,
                    stream: kind,
                    chunk,
                });
            }
        } catch {
            // stream closed
        }
    }
}
