/**
 * HiveLearnExecutor — puente entre DAGScheduler y runHiveLearnAgent.
 *
 * Usa runHiveLearnAgent() que internamente llama al agent-loop local,
 * sin tocar el context-compiler ni la lógica del enjambre principal.
 */
import type { TaskNode } from '../scheduler/dag'
import { runHiveLearnAgent } from './runner'
import { AGENT_PROMPTS } from './prompts'
import { AGENT_EXECUTABLE_TOOLS } from './tool-map'

const DEFAULT_PROMPT = 'Eres un agente educativo de HiveLearn. Responde en JSON estructurado.'

export class HiveLearnExecutor {
  async execute(
    node: TaskNode,
    depResults: Record<string, string>,
    threadId: string
  ): Promise<string> {
    const hasDeps = Object.keys(depResults).length > 0
    const contextBlock = hasDeps
      ? `\n\n---\nResultados de agentes anteriores:\n${JSON.stringify(depResults, null, 2)}\n---`
      : ''

    const systemPrompt = AGENT_PROMPTS[node.agentId] ?? DEFAULT_PROMPT
    const tools = AGENT_EXECUTABLE_TOOLS[node.agentId] ?? []

    return runHiveLearnAgent({
      agentId: node.agentId,
      taskDescription: node.taskDescription + contextBlock,
      systemPrompt,
      tools,
      threadId,
    })
  }
}
