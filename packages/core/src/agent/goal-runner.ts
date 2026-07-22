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
 * The budget is HARD: iterations, tokens, and turns all count across the
 * entire run (not per-turn). This prevents endless loops.
 */

import { logger } from "../utils/logger";
import { callLLM, type LLMMessage } from "./llm-client";
import { createRun, type AcceptanceCriterion } from "./run-store";
import { clearOldToolResults } from "./compaction";
import { loadConfig } from "../config/loader";
import { getDurableQueue } from "../gateway/durable-queue";

export type { AcceptanceCriterion } from "./run-store";

export interface AcceptanceResult {
  id: string;
  description: string;
  met: boolean;
  evidence: string;
}

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
  /** Whole-job acceptance criteria — when set, the goal is only "met" once every criterion is. */
  acceptance?: AcceptanceCriterion[];
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
    acceptance: opts.acceptance,
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
      maxAttempts,
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
 *
 * When `acceptance` criteria are supplied, each is verified independently
 * (its own checkTool, or an LLM judgment against its own description) and
 * the overall verdict is the conjunction of all of them — the top-level
 * `goal`/`checkTool` are ignored in that case.
 */
export async function verifyGoal(
  goal: string,
  checkTool: string | null | undefined,
  messages: LLMMessage[],
  providerCfg: any,
  acceptance?: AcceptanceCriterion[] | null,
): Promise<{ met: boolean; reason: string; acceptanceResults?: AcceptanceResult[] }> {
  if (acceptance && acceptance.length > 0) {
    const results: AcceptanceResult[] = [];
    for (const criterion of acceptance) {
      const verdict = await verifyGoal(criterion.description, criterion.checkTool, messages, providerCfg);
      results.push({ id: criterion.id, description: criterion.description, met: verdict.met, evidence: verdict.reason });
    }
    const met = results.every((r) => r.met);
    const reason = results.map((r) => `${r.met ? "✅" : "❌"} ${r.description}: ${r.evidence}`).join("\n");
    return { met, reason, acceptanceResults: results };
  }

  // If we have a deterministic check tool, execute it
  if (checkTool) {
    try {
      const { executeToolBatch } = await import("../tool-runtime");
      const { createAllTools } = await import("../tools/index");
      const allTools = createAllTools(loadConfig());
      const toolDef = allTools.find((t) => t.name === checkTool);
      if (!toolDef) {
        log.warn(`[verifyGoal] Check tool "${checkTool}" not found in the tool registry — falling back to LLM verifier`);
      } else {
        const toolResults = await executeToolBatch({
          toolCalls: [{
            id: "goal-check",
            function: { name: checkTool, arguments: JSON.stringify({ goal }) },
          }],
          allTools,
          toolConfig: {},
        });
        const result = toolResults[0];
        if (result?.ok) {
          return interpretCheckResult(result.result);
        }
        return { met: false, reason: `Check tool failed: ${result?.error?.message ?? "unknown"}` };
      }
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

/**
 * Interpret a check tool's result strictly: an object with a boolean `met`,
 * a bare boolean, or a JSON string with `met` — anything else is not met.
 */
function interpretCheckResult(raw: unknown): { met: boolean; reason: string } {
  if (typeof raw === "boolean") {
    return { met: raw, reason: raw ? "Check tool returned true" : "Check tool returned false" };
  }
  if (raw && typeof raw === "object" && "met" in (raw as Record<string, unknown>)) {
    const obj = raw as { met: unknown; reason?: unknown };
    return { met: obj.met === true, reason: typeof obj.reason === "string" ? obj.reason : `Check tool met=${obj.met === true}` };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "true" || trimmed === "false") {
      return { met: trimmed === "true", reason: `Check tool returned "${trimmed}"` };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "met" in parsed) {
        return { met: parsed.met === true, reason: typeof parsed.reason === "string" ? parsed.reason : `Check tool met=${parsed.met === true}` };
      }
      if (typeof parsed === "boolean") {
        return { met: parsed, reason: `Check tool returned ${parsed}` };
      }
    } catch { /* not JSON */ }
  }
  return { met: false, reason: "Check tool result had no interpretable met/true signal" };
}