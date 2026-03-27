/**
 * CodeBridge Tools - 3 tools
 *
 * @category codebridge
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { emitBridgeEvent } from "../bridge-events.ts";

const log = logger.child("codebridge");
const CODE_BRIDGE_PORT = parseInt(process.env.CODE_BRIDGE_PORT ?? "18791", 10);
const CODE_BRIDGE_URL = `ws://localhost:${CODE_BRIDGE_PORT}/ws`;
const CODE_BRIDGE_BASE = `http://localhost:${CODE_BRIDGE_PORT}`;

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
        description: "CLI command to run (alias: agent)",
      },
      agent: {
        type: "string",
        enum: ["qwen", "claude", "opencode", "gemini"],
        description: "Alias for cli (deprecated, use cli instead)",
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
    required: ["prompt"],
  },
  execute: async (params: Record<string, unknown>) => {
    // Support both 'cli' and 'agent' (deprecated alias)
    const cli = (params.cli as string) ?? (params.agent as string);
    const prompt = params.prompt as string;
    const role = (params.role as string) ?? "development";
    const timeoutSeconds = (params.timeoutSeconds as number) ?? 600;

    if (!cli) {
      log.error(`[codebridge_launch] ❌ Error: falta parámetro 'cli' o 'agent'`);
      return {
        ok: false,
        error: "Missing required parameter: 'cli' or 'agent'. Use: codebridge_launch({ cli: 'qwen', prompt: '...' })",
      };
    }

    if (!prompt) {
      log.error(`[codebridge_launch] ❌ Error: falta parámetro 'prompt'`);
      return {
        ok: false,
        error: "Missing required parameter: 'prompt'. Use: codebridge_launch({ cli: 'qwen', prompt: '...' })",
      };
    }

    log.info(`[codebridge_launch] Iniciando subagente ${cli} para rol: ${role}`);
    log.info(`[codebridge_launch] Code Bridge URL: ${CODE_BRIDGE_URL}`);
    log.info(`[codebridge_launch] Code Bridge Base: ${CODE_BRIDGE_BASE}`);

    try {
      // Check if Code Bridge is available
      log.info(`[codebridge_launch] Verificando disponibilidad de Code Bridge...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`${CODE_BRIDGE_BASE}/health`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        log.error(`[codebridge_launch] Code Bridge respondió con estado ${response.status}`);
        return {
          ok: false,
          error: "Code Bridge not available. Start with: bun run packages/code-bridge/src/index.ts",
        };
      }

      log.info(`[codebridge_launch] ✅ Code Bridge disponible`);

      // Launch via WebSocket
      log.info(`[codebridge_launch] Conectando WebSocket a ${CODE_BRIDGE_URL}...`);
      const ws = new WebSocket(CODE_BRIDGE_URL);
      const taskId = `task_${Date.now()}`;
      log.info(`[codebridge_launch] Task ID generado: ${taskId}`);

      return new Promise((resolve) => {
        let resolved = false;
        let timeoutHandle: ReturnType<typeof setTimeout>;

        const done = () => {
          clearTimeout(timeoutHandle);
          ws.close();
        };

        ws.onopen = () => {
          log.info(`[codebridge_launch] ✅ WebSocket conectado`);
          log.info(`[codebridge_launch] Enviando comando launch para task ${taskId}...`);
          log.info(`[codebridge_launch] Parámetros: cli=${cli}, prompt=${prompt?.substring(0, 50)}..., role=${role}, timeout=${timeoutSeconds}`);
          
          const launchCmd = {
            cmd: "launch",
            taskId,
            config: { role, cli, timeoutSeconds },
            prompt,
          };
          
          log.info(`[codebridge_launch] Comando JSON: ${JSON.stringify(launchCmd, null, 2).substring(0, 200)}...`);
          ws.send(JSON.stringify(launchCmd));
        };

        ws.onmessage = (event) => {
          let data: any;
          try { data = JSON.parse(event.data as string); } catch { return; }

          log.info(`[codebridge_launch] 📩 WebSocket message: ${data.type}`, data.taskId ? `task: ${data.taskId}` : "");

          if (data.type === "ack" && !resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            log.info(`[codebridge_launch] ✅ Launch ACK recibido - PID: ${data.pid}`);
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
            log.info(`[codebridge_launch] ✅ Agente finalizado - Exit code: ${data.exitCode ?? 0}`);
            emitBridgeEvent({ type: "bridge:cmd_done", data: { processId: taskId, exitCode: data.exitCode ?? 0, success: true } });
            done();
          } else if (data.type === "agent:error") {
            log.error(`[codebridge_launch] ❌ Error del agente: ${data.message}`);
            emitBridgeEvent({ type: "bridge:cmd_error", data: { processId: taskId, message: data.message } });
            done();
          } else if (data.type === "agent:cancelled") {
            log.warn(`[codebridge_launch] ⚠️ Agente cancelado`);
            emitBridgeEvent({ type: "bridge:cmd_done", data: { processId: taskId, exitCode: -1, success: false } });
            done();
          }
        };

        ws.onerror = () => {
          log.error(`[codebridge_launch] ❌ Error de WebSocket`);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            resolve({ ok: false, error: "Failed to connect to Code Bridge" });
          }
        };

        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            log.error(`[codebridge_launch] ⏱️ Timeout esperando respuesta de Code Bridge`);
            resolved = true;
            ws.close();
            resolve({ ok: false, error: "Timeout connecting to Code Bridge" });
          }
        }, 5000);
      });
    } catch (error) {
      log.error(`[codebridge_launch] ❌ Error fatal: ${(error as Error).message}`);
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
      const response = await fetch(`${CODE_BRIDGE_BASE}/status/${taskId}`);

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
      const response = await fetch(`${CODE_BRIDGE_BASE}/cancel/${taskId}`, { method: "POST" });

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

// ─── codebridge_feedback ───────────────────────────────────────────────────────

export const codebridgeFeedbackTool: Tool = {
  name: "codebridge_feedback",
  description: "Send feedback or additional instructions to a running CodeBridge subagent. Use for course correction, clarifications, or iterative improvements during long-running code tasks. Spanish: enviar feedback, corregir rumbo, aclaraciones, mejoras iterativas",
  parameters: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "Task ID to send feedback to",
      },
      feedback: {
        type: "string",
        description: "Feedback message or additional instructions for the running agent",
      },
    },
    required: ["taskId", "feedback"],
  },
  execute: async (params: Record<string, unknown>) => {
    const taskId = params.taskId as string;
    const feedback = params.feedback as string;

    try {
      const ws = new WebSocket(CODE_BRIDGE_URL);
      
      return new Promise((resolve) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({
            cmd: "feedback",
            taskId,
            feedback,
          }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "feedback:ack") {
              resolve({
                ok: data.delivered,
                taskId,
                delivered: data.delivered,
                reason: data.reason,
                message: data.delivered 
                  ? "Feedback delivered to running agent" 
                  : `Feedback not delivered: ${data.reason}`,
              });
            }
          } catch {
            resolve({ ok: false, error: "Failed to parse feedback response" });
          }
          ws.close();
        };

        ws.onerror = () => {
          resolve({ ok: false, error: "WebSocket error" });
          ws.close();
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          resolve({ ok: false, error: "Feedback timeout" });
          ws.close();
        }, 5000);
      });
    } catch (error) {
      return {
        ok: false,
        error: `Failed to send feedback: ${(error as Error).message}`,
      };
    }
  },
};

export function createTools(): Tool[] {
  return [codebridgeLaunchTool, codebridgeStatusTool, codebridgeCancelTool, codebridgeFeedbackTool];
}
