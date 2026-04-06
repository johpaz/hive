/**
 * HiveLearn Agent Runner
 *
 * Wrapper delgado que resuelve configuración de proveedor desde la DB compartida
 * y delega la ejecución multi-turno al agent-loop local.
 *
 * Sin dependencias de context-compiler, agent-bus ni lógica del enjambre principal.
 */
import { resolveProviderConfig } from '../llm/client'
import { runAgentLoop } from './agent-loop'
import type { Tool } from '../types/tool'
import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'
import { logger } from '../utils/logger'

const log = logger.child('hl-runner')

export async function runHiveLearnAgent(opts: {
  agentId: string
  taskDescription: string
  systemPrompt: string
  tools: Tool[]
  threadId: string
}): Promise<string> {
  const db = getDb()

  const agent = db.query<any, [string]>('SELECT * FROM agents WHERE id = ?').get(opts.agentId)
  if (!agent) throw new Error(`HiveLearn agent not found in DB: ${opts.agentId}`)

  // agents.model_id es el nombre real de la API (ej. "gemini-3-flash-preview")
  const modelId = agent.model_id ?? 'llama3.2'
  const providerId = agent.provider_id || 'ollama'

  const providerConfig = await resolveProviderConfig(providerId, modelId)

  const cleanModel = providerConfig.model.replace(new RegExp(`^${providerConfig.provider}\\/`), '')
  log.info(`[hl-runner] ${opts.agentId} → ${providerConfig.provider}/${cleanModel} tools=${opts.tools.length}`)

  return runAgentLoop({
    systemPrompt: opts.systemPrompt,
    taskDescription: opts.taskDescription,
    tools: opts.tools,
    providerConfig,
    maxTokens: 2048,
    temperature: 0.3,
  })
}
