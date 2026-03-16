/**
 * Hive Scheduler - Pipeline Integration
 * 
 * Integrates scheduled tasks with the Hive agent pipeline.
 * Converts scheduled tasks into system messages that flow through the agent system.
 */

import type { ScheduledTask, TaskExecutionResult } from "./types";
import { logger } from "../utils/logger";
import { getDb } from "../storage/sqlite";
import { buildAgentLoop } from "../agent/agent-loop";
import { resolveAgentId } from "../storage/onboarding";

const log = logger.child("SchedulerIntegration");

// Scheduler instance for internal tasks (e.g., cleanup)
let _scheduler: { runCleanup(): void } | null = null;

export function setSchedulerForCleanup(scheduler: { runCleanup(): void }): void {
  _scheduler = scheduler;
}

/**
 * Execute a scheduled task through the agent pipeline
 * 
 * This handler:
 * 1. Parses the task payload
 * 2. Builds a system message with metadata
 * 3. Routes to the target agent (or Coordinator if none specified)
 * 4. Executes the tool if tool_name is specified
 * 5. Returns the agent response
 */
export async function executeScheduledTask(task: ScheduledTask): Promise<TaskExecutionResult> {
  log.info(`[execute] Processing task "${task.name}" (${task.id})`);

  try {
    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(task.payload);
    } catch (err) {
      log.error(`[execute] Invalid payload JSON for task "${task.id}": ${(err as Error).message}`);
      return { success: false, error: "Invalid payload JSON" };
    }

    // Extract prompt/message from payload
    const prompt = (payload.prompt || payload.message) as string | undefined;
    if (!prompt && !payload._internal) {
      log.error(`[execute] Task "${task.id}" has no prompt or message in payload`);
      return { success: false, error: "Missing prompt or message in payload" };
    }

    // Handle internal cleanup task
    if (payload._internal === true && (payload as any).action === "cleanup") {
      // The cleanup is handled by the scheduler itself via runCleanup()
      log.info("[execute] Cleanup task acknowledged");
      return { success: true, response: "Cleanup completed" };
    }

    // Build message metadata
    const metadata = {
      source: "scheduler" as const,
      task_id: task.id,
      task_name: task.name,
      channel: task.channel,
      scheduled: true,
      tool_name: task.tool_name || undefined,
    };

    // Determine target agent
    let targetAgentId: string | null = task.agent_id || null;
    
    // If no agent specified, route to Coordinator
    if (!targetAgentId) {
      targetAgentId = resolveAgentId(null);
      log.debug(`[execute] No agent specified, routing to Coordinator: ${targetAgentId}`);
    }

    // Get user timezone for context
    const db = getDb();
    const user = db.query("SELECT timezone, language FROM users LIMIT 1").get() as { 
      timezone: string; 
      language: string | null;
    } | undefined;

    const userTimezone = user?.timezone || "UTC";
    const userLanguage = user?.language || "en";

    // Build context with current datetime in user's timezone
    const now = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = {
      timeZone: userTimezone,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      timeZone: userTimezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };

    const fecha_usuario = new Intl.DateTimeFormat(userLanguage === "es" ? "es-ES" : "en-US", dateOptions).format(now);
    const hora_usuario = new Intl.DateTimeFormat(userLanguage === "es" ? "es-ES" : "en-US", timeOptions).format(now);

    // Build the full prompt with context
    const contextPrompt = `[SCHEDULED TASK]
Task: ${task.name}
Type: ${task.task_type}
Triggered at: ${hora_usuario} on ${fecha_usuario} (${userTimezone})

${prompt || `Execute tool: ${task.tool_name}`}`;

    log.debug(`[execute] Sending to agent ${targetAgentId}: "${contextPrompt.slice(0, 100)}..."`);

    // Build agent loop and execute
    try {
      const agentLoop = buildAgentLoop({ mcpManager: undefined });
      
      // Create a synthetic session ID for this scheduled task
      const sessionId = `sched_${task.id}_${Date.now()}`;

      // Execute through agent loop stream
      const messages = [{ role: "user", content: contextPrompt }];
      const stream = agentLoop.stream({ messages }, {
        configurable: {
          thread_id: sessionId,
          agent_id: targetAgentId || undefined,
          channel: task.channel,
          system_prompt: undefined,
          raw_user_message: contextPrompt,
        },
      });

      // Collect the response from the stream
      let response = "";
      let hasError = false;
      
      for await (const chunk of stream) {
        if (chunk.agent?.messages) {
          const lastMsg = chunk.agent.messages[chunk.agent.messages.length - 1];
          if (lastMsg?.content) {
            response += lastMsg.content;
          }
        }
        if (chunk.tools?.messages) {
          // Check for tool errors
          for (const msg of chunk.tools.messages) {
            if (msg.content?.error) {
              hasError = true;
              response += ` [Tool error: ${JSON.stringify(msg.content)}]`;
            }
          }
        }
      }

      if (hasError && !response) {
        throw new Error("Agent execution returned errors");
      }

      log.info(`[execute] Agent response received for task "${task.name}"`);

      return {
        success: true,
        response: response || "Task executed successfully",
      };
    } catch (agentErr) {
      log.error(`[execute] Agent execution failed: ${(agentErr as Error).message}`);
      return {
        success: false,
        error: `Agent execution failed: ${(agentErr as Error).message}`,
      };
    }
  } catch (err) {
    log.error(`[execute] Task execution failed: ${(err as Error).message}`);
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Send notification to user's channel after task execution
 * 
 * This is called after a task completes to notify the user
 * via their preferred channel (if not system).
 */
export async function notifyTaskCompletion(
  taskId: string,
  taskName: string,
  success: boolean,
  response?: string,
  error?: string
): Promise<void> {
  const db = getDb();

  // Get task details
  const task = db.query(
    "SELECT channel, agent_id FROM scheduled_tasks WHERE id = ?"
  ).get(taskId) as { channel: string; agent_id: string | null } | undefined;

  if (!task) {
    log.warn(`[notify] Task "${taskId}" not found`);
    return;
  }

  // Skip notification for system channel
  if (task.channel === "system") {
    log.debug(`[notify] Skipping notification for system channel`);
    return;
  }

  // Get user's preferred notification channel
  const userId = resolveAgentId(null);
  const identities = db.query(
    "SELECT channel FROM user_identities WHERE user_id = ? ORDER BY channel"
  ).all(userId || "") as { channel: string }[];

  // Determine best channel
  let notifyChannel = task.channel;
  if (!identities.some((i) => i.channel === notifyChannel)) {
    // Fall back to first available channel
    const preferred = ["telegram", "discord", "slack", "whatsapp", "webchat"];
    for (const p of preferred) {
      if (identities.some((i) => i.channel === p)) {
        notifyChannel = p;
        break;
      }
    }
  }

  // Build notification message
  const status = success ? "✅" : "❌";
  const message = success
    ? `${status} Scheduled task "${taskName}" completed\n${response || ""}`
    : `${status} Scheduled task "${taskName}" failed\n${error || ""}`;

  log.info(`[notify] Sending notification to ${notifyChannel}: "${message.slice(0, 50)}..."`);

  // TODO: Integrate with channel manager to send actual notification
  // This requires access to the ChannelManager instance which is created at gateway level
  // For now, we log the notification
}

/**
 * Create the task execution handler for CronScheduler
 */
export function createTaskHandler() {
  return executeScheduledTask;
}
