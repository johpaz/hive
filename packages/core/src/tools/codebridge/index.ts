/**
 * CodeBridge Tools - 3 tools
 *
 * @category codebridge
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { emitBridgeEvent } from "../bridge-events.ts";

const log = logger.child("codebridge");
const CODE_BRIDGE_URL = "ws://localhost:18791/ws";

// ─── codebridge_launch ───────────────────────────────────────────────────────

export const codebridgeLaunchTool: Tool = {
  name: "codebridge_launch",
  description: "Launch an external coding CLI subagent (Claude Code, Qwen CLI, Gemini CLI, OpenCode CLI) to execute a coding task locally. Spanish: lanzar agente de código, iniciar Claude Code, Qwen CLI, Gemini CLI, OpenCode, subagente externo de programación",
  parameters: {
    type: "object",
    properties: {
      cli: {
        type: "string",
        enum: ["qwen", "claude", "opencode", "gemini"],
        description: "CLI command to run",
      },
      prompt: {
        type: "string",
        description: "The prompt/task for the subagent",
      },
      role: {
        type: "string",
        enum: ["architecture", "development", "testing", "documentation"],
        description: "Role of the subagent",
      },
      timeoutSeconds: {
        type: "number",
        description: "Timeout in seconds (default: 600)",
      },
    },
    required: ["cli", "prompt"],
  },
  execute: async (params: Record<string, unknown>) => {
    const cli = params.cli as string;
    const prompt = params.prompt as string;
    const role = (params.role as string) ?? "development";
    const timeoutSeconds = (params.timeoutSeconds as number) ?? 600;

    try {
      // Check if Code Bridge is available
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch("http://localhost:18791/health", { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ok: false,
          error: "Code Bridge not available. Start with: bun run packages/code-bridge/src/index.ts",
        };
      }

      // Launch via WebSocket
      const ws = new WebSocket(CODE_BRIDGE_URL);
      const taskId = `task_${Date.now()}`;

      return new Promise((resolve) => {
        let resolved = false;
        let timeoutHandle: ReturnType<typeof setTimeout>;

        const done = () => {
          clearTimeout(timeoutHandle);
          ws.close();
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({
            cmd: "launch",
            taskId,
            config: { role, cli, timeoutSeconds },
            prompt,
          }));
        };

        ws.onmessage = (event) => {
          let data: any;
          try { data = JSON.parse(event.data as string); } catch { return; }

          if (data.type === "ack" && !resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            emitBridgeEvent({ type: "bridge:cmd_start", data: { processId: taskId, command: cli, name: role } });
            resolve({
              ok: true,
              taskId,
              pid: data.pid,
              message: `Launched ${cli} with PID ${data.pid}`,
            });
            // Keep WS open to relay subsequent events
            return;
          }

          if (data.taskId !== taskId) return;

          if (data.type === "agent:output") {
            emitBridgeEvent({ type: "bridge:cmd_output", data: { processId: taskId, chunk: data.chunk, stream: data.stream ?? "stdout" } });
          } else if (data.type === "agent:finished") {
            emitBridgeEvent({ type: "bridge:cmd_done", data: { processId: taskId, exitCode: data.exitCode ?? 0, success: true } });
            done();
          } else if (data.type === "agent:error") {
            emitBridgeEvent({ type: "bridge:cmd_error", data: { processId: taskId, message: data.message } });
            done();
          } else if (data.type === "agent:cancelled") {
            emitBridgeEvent({ type: "bridge:cmd_done", data: { processId: taskId, exitCode: -1, success: false } });
            done();
          }
        };

        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            resolve({ ok: false, error: "Failed to connect to Code Bridge" });
          }
        };

        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.close();
            resolve({ ok: false, error: "Timeout connecting to Code Bridge" });
          }
        }, 5000);
      });
    } catch (error) {
      return {
        ok: false,
        error: `Failed to launch: ${(error as Error).message}`,
      };
    }
  },
};

// ─── codebridge_status ───────────────────────────────────────────────────────

export const codebridgeStatusTool: Tool = {
  name: "codebridge_status",
  description: "Check the status and output of a running CodeBridge subagent. Spanish: estado agente de código, verificar Claude Code, progreso subagente externo",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "Task ID to check status for",
      },
    },
    required: ["taskId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const taskId = params.taskId as string;

    try {
      const response = await fetch(`http://localhost:18791/status/${taskId}`);
      
      if (!response.ok) {
        return { ok: false, error: `Task not found: ${taskId}` };
      }

      const data = await response.json();
      return { ok: true, ...data };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to get status: ${(error as Error).message}`,
      };
    }
  },
};

// ─── codebridge_cancel ───────────────────────────────────────────────────────

export const codebridgeCancelTool: Tool = {
  name: "codebridge_cancel",
  description: "Cancel and terminate a running CodeBridge subagent process. Spanish: cancelar agente de código, detener Claude Code, terminar subagente externo",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "Task ID to cancel",
      },
    },
    required: ["taskId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const taskId = params.taskId as string;

    try {
      const response = await fetch(`http://localhost:18791/cancel/${taskId}`, { method: "POST" });
      
      if (!response.ok) {
        return { ok: false, error: `Failed to cancel: ${taskId}` };
      }

      return { ok: true, taskId, message: "Task cancelled." };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to cancel: ${(error as Error).message}`,
      };
    }
  },
};

export function createTools(): Tool[] {
  return [codebridgeLaunchTool, codebridgeStatusTool, codebridgeCancelTool];
}
