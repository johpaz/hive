/**
 * goal-runner — orchestrates a multi-turn agent run toward a verifiable goal.
 *
 * Flow:
 * 1. Create an AgentRun (kind="goal") with goal + budget
 * 2. Run agent turns until:
 *    - Goal is met (verified by goal_check_tool or LLM verifier)
 *    - Budget exhausted (iterations/tokens/turns)
 *    - Max goal attempts reached
 * 3. Between turns: compact context, inject goal/reason/budget reminder
 * 4. On completion: persist success/failure + notify channel
 *
 * The═budget═is═HARD: iterations, tokens, and turns all count across the
 * entire run (not per-turn). This prevents endless loops.
 */

import { logger } from "../utils/logger";
import { callLLM, resolveProviderConfig, getDefaultLLM, type LLMMessage } from "./llm-client";
import { createRun, getRun, completeRun, failRun, interruptRun, bumpTurn } from "./run-store";
import { sendToUserChannel } from "../gateway/channel-notify";
import { clearOldToolResults } from "./compaction";
import { getBootId } from "../storage/boot-id";
import { getDurableQueue } from "../gateway/durable-queue";
import type { AgentDoc } from "../storage/collections";

const log = logger.child("goal-runner");

const MAX_GOAL_ATTEMPTS = 5;

export interface GoalRunOptions {
  agentId: string;
  threadId: string;
  userId: string;
  channel: string | null;
  goal: string;
  goalCheckTool?: string | null;
  maxIterationsPerTurn?: number;
  maxTurns?: number;
  maxTokens?: number;
  maxAttempts?: number;
}

export interface GoalRunResult {
  met: boolean;
  reason: string;
  turnsUsed: number;
  iterationsUsed: number;
  tokensUsed: number;
  attempts: number;
  finalContent: string;
}

/**
 * Run a goal-based agent loop with verification between turns.
 */
export async function runGoal(opts: GoalRunOptions): Promise<GoalRunResult> {
  const maxAttempts = opts.maxAttempts ?? MAX_GOAL_ATTEMPTS;
  const maxIterationsPerTurn = opts.maxIterationsPerTurn ?? 20;
  const maxTurns = opts.maxTurns ?? 10;
  const maxTokens = opts.maxTokens ?? 200_000;

  log.info(`[runGoal] Starting goal="${opts.goal}" agent=${opts.agentId} maxTurns=${maxTurns} maxAttempts=${maxAttempts}`);

  // Create the durable AgentRun
  const run = await createRun({
    thread_id: opts.threadId,
    agent_id: opts.agentId,
    user_id: opts.userId,
    channel: opts.channel,
    kind: "goal",
    max_iterations: maxIterationsPerTurn * maxTurns,
    max_turns: maxTurns,
    max_tokens: maxTokens,
    goal: opts.goal,
    goal_check_tool: opts.goalCheckTool ?? null,
    resume_policy: "resume",
  });

  // Enqueue a goal_run job in the durable queue
  const queue = getDurableQueue();
  const job = await queue.enqueue({
    lane: `goal:${run.id}`,
    type: "goal_run",
    run_id: run.id,
    payload: {
      agentId: opts.agentId,
      threadId: opts.threadId,
      goal: opts.goal,
      goal_check_tool: opts.goalCheckTool,
      resume: false,
      budget: {
        maxIterations: maxIterationsPerTurn,
        maxTurns,
        maxTokens,
      },
    },
  });

  log.info(`[runGoal] Enqueued goal_run job ${job.id} for run ${run.id}`);

  // Note: The actual execution happens asynchronously via the durable queue's
  // goal_run executor. This function returns the initial state — the caller
  // can poll the run status or subscribe to the channel for notifications.
  return {
    met: false,
    reason: "Goal run enqueued — execution is asynchronous. Poll task_status or watch the channel for completion.",
    turnsUsed: 0,
    iterationsUsed: 0,
    tokensUsed: 0,
    attempts: 0,
    finalContent: "",
  };
}

/**
 * Verify whether a goal has been met using either:
 * - A deterministic tool (goal_check_tool) — executes the tool and checks the result
 * - An LLM verifier — asks the model to return JSON {met, reason}
 */
export async function verifyGoal(
  goal: string,
  checkTool: string | null | undefined,
  messages: LLMMessage[],
  providerCfg: any,
): Promise<{ met: boolean; reason: string }> {
  // If we have a deterministic check tool, execute it
  if (checkTool) {
    try {
      const { executeToolBatch } = await import("../tool-runtime");
      const toolResults = await executeToolBatch({
        toolCalls: [{
          id: "goal-check",
          function: { name: checkTool, arguments: JSON.stringify({ goal }) },
        }],
        allTools: [],
        toolConfig: {},
      });
      const result = toolResults[0];
      if (result?.ok) {
        const content = String(result.result);
        const met = content.toLowerCase().includes("true") || content.toLowerCase().includes('"met": true');
        return { met, reason: met ? "Goal check tool confirmed success" : "Goal check tool returned false" };
      }
      return { met: false, reason: `Check tool failed: ${result?.error?.message ?? "unknown"}` };
    } catch (err) {
      log.warn(`[verifyGoal] Check tool "${checkTool}" failed: ${(err as Error).message}`);
      // Fall through to LLM verifier
    }
  }

  // LLM verifier: ask the model to evaluate whether the goal is met
  try {
    const verificationMessages: LLMMessage[] = [
      ...clearOldToolResults(messages),
      {
        role: "user",
        content: `Evaluá si el siguiente objetivo ha sido cumplido basándote en la conversación anterior.\n\nObjetivo: "${goal}"\n\nRespondé en JSON:\n{"met": true/false, "reason": "explicación breve"}`,
      },
    ];

    const response = await callLLM({
      ...providerCfg,
      messages: verificationMessages,
      tools: undefined,
    });

    const content = response.content?.trim() || "";
    // Extract JSON from the response
    const jsonMatch = content.match(/\{[^}]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        met: !!parsed.met,
        reason: parsed.reason || "No reason provided",
      };
    }
    return { met: false, reason: "Could not parse verification response" };
  } catch (err) {
    log.warn(`[verifyGoal] LLM verification failed: ${(err as Error).message}`);
    return { met: false, reason: `Verification error: ${(err as Error).message}` };
  }
}