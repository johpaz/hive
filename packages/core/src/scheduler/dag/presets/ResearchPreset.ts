/**
 * ResearchPreset — Pre-configured DAG for general research swarms
 *
 * Dependency graph:
 *   ResearchAgent ─┐
 *   StrategyAgent  ├── SynthesisAgent  (all three run in parallel)
 *   DesignAgent   ─┘
 *
 * All three parallel agents are fully independent. SynthesisAgent
 * waits for all three and combines their outputs into a final deliverable.
 *
 * Usage:
 *   const graph = createResearchGraph(
 *     { research: "agent-uuid-1", strategy: "agent-uuid-2",
 *       design: "agent-uuid-3", synthesis: "agent-uuid-4" },
 *     "Design a distributed caching strategy for HiveLearn"
 *   )
 *   await scheduler.execute(graph, { projectId, coordinatorId })
 */

import { TaskGraph } from "../TaskGraph"
import type { TaskNodeConfig } from "../TaskNode"

export interface ResearchAgentIds {
  research: string
  strategy: string
  design: string
  synthesis: string
}

export function createResearchGraph(
  agentIds: ResearchAgentIds,
  topic: string,
  options: {
    researchTimeout?: number
    strategyTimeout?: number
    designTimeout?: number
    synthesisTimeout?: number
  } = {}
): TaskGraph {
  const nodes: TaskNodeConfig[] = [
    {
      id: "research",
      agentId: agentIds.research,
      name: "ResearchAgent",
      taskDescription:
        `Research the following topic using available knowledge bases and sources: "${topic}".` +
        ` Output: { findings: string[], sources: string[], keyInsights: string[] }.`,
      deps: [],
      timeout: options.researchTimeout ?? 120_000,
      maxRetries: 1,
      priority: 8,
    },
    {
      id: "strategy",
      agentId: agentIds.strategy,
      name: "StrategyAgent",
      taskDescription:
        `Design a strategic framework or approach for: "${topic}".` +
        ` Work independently — you will NOT have the research findings yet.` +
        ` Output: { approach: string, phases: string[], risks: string[], successMetrics: string[] }.`,
      deps: [],
      timeout: options.strategyTimeout ?? 90_000,
      maxRetries: 1,
      priority: 8,
    },
    {
      id: "design",
      agentId: agentIds.design,
      name: "DesignAgent",
      taskDescription:
        `Design the structure or architecture for: "${topic}".` +
        ` Work independently — focus on structure, not content.` +
        ` Output: { structure: string, components: string[], diagram: string (ASCII or Mermaid) }.`,
      deps: [],
      timeout: options.designTimeout ?? 90_000,
      maxRetries: 1,
      priority: 8,
    },
    {
      id: "synthesis",
      agentId: agentIds.synthesis,
      name: "SynthesisAgent",
      taskDescription:
        `Synthesize the research findings, strategic framework, and design structure into a cohesive deliverable.` +
        ` The dependency context contains all three agents' outputs.` +
        ` Topic: "${topic}".` +
        ` Output a comprehensive, well-structured document that combines all inputs coherently.`,
      deps: ["research", "strategy", "design"],
      timeout: options.synthesisTimeout ?? 150_000,
      maxRetries: 2,
      priority: 0,
    },
  ]

  return new TaskGraph(nodes)
}
