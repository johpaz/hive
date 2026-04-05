/**
 * HiveLearnPreset — Pre-configured DAG for the HiveLearn swarm
 *
 * Dependency graph:
 *   CurriculumAgent (no deps, priority=10)
 *       ↓               ↓
 *   ContentAgent    VisualAgent   ← run IN PARALLEL after Curriculum
 *       ↓               ↓
 *       └──── GamificationAgent (waits for both)
 *
 * Expected timing with maxConcurrentWorkers=2 on BOSGAME:
 *   T=0s    → CurriculumAgent starts
 *   T=~30s  → CurriculumAgent done → Content + Visual start in parallel
 *   T=~100s → both done → GamificationAgent starts
 *   T=~120s → GamificationAgent done → swarm:completed
 *   Savings vs sequential: ~38% (~75s)
 */

import { TaskGraph } from "../TaskGraph"
import type { TaskNodeConfig } from "../TaskNode"

export interface HiveLearnAgentIds {
  curriculum: string
  content: string
  visual: string
  gamification: string
}

export interface HiveLearnInput {
  learnerGoal: string
  nodeType: string
  /** Optional session/user context to include in descriptions */
  context?: string
}

export function createHiveLearnGraph(
  agentIds: HiveLearnAgentIds,
  input: HiveLearnInput
): TaskGraph {
  const ctxNote = input.context ? ` Context: ${input.context}` : ""

  const nodes: TaskNodeConfig[] = [
    {
      id: "curriculum",
      agentId: agentIds.curriculum,
      name: "CurriculumAgent",
      taskDescription:
        `Design a structured curriculum for the following learner goal: "${input.learnerGoal}".` +
        ` Focus on the node type: "${input.nodeType}".` +
        ` Output a JSON object with: { title, objectives: string[], prerequisites: string[], estimatedMinutes: number }.` +
        ctxNote,
      deps: [],
      timeout: 60_000,
      maxRetries: 1,
      priority: 10,
    },
    {
      id: "content",
      agentId: agentIds.content,
      name: "ContentAgent",
      taskDescription:
        `Generate educational content for the node type "${input.nodeType}".` +
        ` Use the curriculum from the dependency context.` +
        ` Output: { explanation: string, examples: string[], exercises: { question: string, answer: string }[] }.`,
      deps: ["curriculum"],
      timeout: 90_000,
      maxRetries: 2,
      priority: 5,
    },
    {
      id: "visual",
      agentId: agentIds.visual,
      name: "VisualAgent",
      taskDescription:
        `Generate visual asset descriptions for the node type "${input.nodeType}".` +
        ` You only need the curriculum context (NOT the full text content).` +
        ` Output: { diagram: string (mermaid or ASCII), iconSuggestion: string, colorTheme: string }.`,
      deps: ["curriculum"],
      timeout: 120_000,
      maxRetries: 2,
      priority: 5,
    },
    {
      id: "gamification",
      agentId: agentIds.gamification,
      name: "GamificationAgent",
      taskDescription:
        `Add a gamification layer to the educational node.` +
        ` You have access to the generated content AND visual assets in the dependency context.` +
        ` Output: { xpReward: number, badge: string, challengeMode: { description: string, successCriteria: string } }.`,
      deps: ["content", "visual"],
      timeout: 45_000,
      maxRetries: 1,
      priority: 0,
    },
  ]

  return new TaskGraph(nodes)
}
