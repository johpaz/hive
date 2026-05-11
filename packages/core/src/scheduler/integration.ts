/**
 * Hive Scheduler - Pipeline Integration
 * 
 * Integrates cron jobs with the Hive agent pipeline.
 * Converts cron jobs into system messages that flow through the agent system.
 */

import type { CronJob, CronJobExecutionResult } from "./types";
import { logger } from "../utils/logger";
import { getDb } from "../storage/sqlite";
import { buildAgentLoop } from "../agent/agent-loop";
import { resolveAgentId } from "../storage/onboarding";
import { sendToUserChannel } from "../gateway/channel-notify";
import { addMessage } from "../agent/conversation-store";
import { resolveBestChannel } from "../tools/cron/index";

const log = logger.child("SchedulerIntegration");

let _scheduler: { runCleanup(): void } | null = null;

export function setSchedulerForCleanup(scheduler: { runCleanup(): void }): void {
  _scheduler = scheduler;
}

/**
 * Execute a cron job through the agent pipeline
 * 
 * This handler:
 * 1. Parses the job payload
 * 2. Builds a system message with metadata including the `task` field as instruction
 * 3. Routes to the target agent (or Coordinator if none specified)
 * 4. Executes the tool if tool_name is specified
 * 5. Returns the agent response
 */
export async function executeScheduledTask(job: CronJob): Promise<CronJobExecutionResult> {
  log.info(`[execute] Processing job "${job.name}" (${job.id})`);

  try {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(job.payload);
    } catch (err) {
      log.error(`[execute] Invalid payload JSON for job "${job.id}": ${(err as Error).message}`);
      return { success: false, error: "Invalid payload JSON" };
    }

    const prompt = (payload.prompt || payload.message) as string | undefined;
    if (!prompt && !payload._internal && !job.task) {
      log.error(`[execute] Job "${job.id}" has no prompt, message, or task instruction`);
      return { success: false, error: "Missing prompt, message, or task instruction" };
    }

    if (payload._internal === true && (payload as any).action === "cleanup") {
      if (_scheduler) {
        _scheduler.runCleanup();
      } else {
        log.warn("[execute] Cleanup job fired but scheduler instance not available");
      }
      log.info("[execute] Cleanup job executed");
      return { success: true, response: "Cleanup completed" };
    }

    // Build message metadata
    const metadata = {
      source: "scheduler" as const,
      task_id: job.id,
      task_name: job.name,
      channel: job.channel,
      scheduled: true,
      tool_name: job.tool_name || undefined,
    };

    let targetAgentId: string | null = job.agent_id || null;
    
    if (!targetAgentId) {
      targetAgentId = resolveAgentId(null);
      log.debug(`[execute] No agent specified, routing to Coordinator: ${targetAgentId}`);
    }

    const db = getDb();
    const user = db.query("SELECT id, timezone, language FROM users LIMIT 1").get() as {
      id: string;
      timezone: string;
      language: string | null;
    } | undefined;

    const userTimezone = user?.timezone || "UTC";
    const userLanguage = user?.language || "en";

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

    // Build the full prompt with the `task` field as the primary instruction
    const contextPrompt = `[SCHEDULED TASK]
Name: ${job.name}
Instruction: ${job.task}
Type: ${job.task_type}
Triggered at: ${hora_usuario} on ${fecha_usuario} (${userTimezone})

${prompt || `Execute tool: ${job.tool_name}`}`;

    log.debug(`[execute] Sending to agent ${targetAgentId}: "${contextPrompt.slice(0, 100)}..."`);

    try {
      const agentLoop = buildAgentLoop({ mcpManager: undefined });
      
      const sessionId = `sched_${job.id}_${Date.now()}`;

      const agentChannel = (job.channel && job.channel !== "system")
        ? job.channel
        : resolveBestChannel(user?.id || "");

      const messages = [{ role: "user", content: contextPrompt }];
      const stream = agentLoop.stream({ messages }, {
        configurable: {
          thread_id: sessionId,
          agent_id: targetAgentId || undefined,
          channel: agentChannel,
          user_id: user?.id || "",
          system_prompt: undefined,
          raw_user_message: contextPrompt,
        },
      });

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

      log.info(`[execute] Agent response received for job "${job.name}"`);

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
    log.error(`[execute] Job execution failed: ${(err as Error).message}`);
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Send notification to user's channel after job execution
 */
export async function notifyTaskCompletion(
  taskId: string,
  taskName: string,
  success: boolean,
  response?: string,
  error?: string
): Promise<void> {
  const db = getDb();

  const task = db.query(
    "SELECT channel, agent_id FROM cron_jobs WHERE id = ?"
  ).get(taskId) as { channel: string; agent_id: string | null } | undefined;

  if (!task) {
    log.warn(`[notify] Job "${taskId}" not found`);
    return;
  }

  const userRow = db.query("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  const userId = userRow?.id || "";

  const explicitChannel = task.channel && task.channel !== "system" ? task.channel : undefined;
  const notifyChannel = resolveBestChannel(userId, explicitChannel) || "webchat";
  log.info(`[notifyTaskCompletion] task.channel=${task.channel} explicit=${explicitChannel} resolved=${notifyChannel}`);

  const status = success ? "✅" : "❌";
  const message = success
    ? `${status} Scheduled task "${taskName}" completed\n${response || ""}`
    : `${status} Scheduled task "${taskName}" failed\n${error || ""}`;

  log.info(`[notify] Sending notification to ${notifyChannel}: "${message.slice(0, 50)}..."`);

  try {
    addMessage(userId, "assistant", message, { channel: notifyChannel });
  } catch (e) {
    log.warn(`[notify] Failed to persist notification to DB: ${(e as Error).message}`);
  }

  await sendToUserChannel(notifyChannel, userId, message);
  log.info(`[notify] Notification sent to ${notifyChannel}`);
}

/**
 * Create the job execution handler for CronScheduler
 */
export function createTaskHandler() {
  return executeScheduledTask;
}