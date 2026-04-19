/**
 * HiveLearn Agent Loop — multi-turno, completamente independiente del core.
 *
 * Patrón de ejecución:
 * 1. Llama al LLM con el system prompt + task description + tool definitions
 * 2. Si el LLM hace una tool_call:
 *    a. Ejecuta tool.execute(args) si la tool tiene execute()
 *    b. Si execute() es un passthrough (solo hace eco de params) → retorna los
 *       args como output estructurado final (comportamiento "structured output via tools")
 *    c. Si execute() hace trabajo real (búsqueda, DB) → alimenta el resultado
 *       de vuelta al LLM y continúa el loop
 * 3. Si el LLM produce texto → retorna ese texto
 * 4. maxIterations como safety cap
 */
import { callLLM } from '@johpaz/hive-agents-core/agent/llm-client'
import type { LLMMessage, LLMToolDef, LLMCallOptions } from '@johpaz/hive-agents-core/agent/llm-client'
import type { Tool } from '../types/tool'
import { logger } from '../utils/logger'
import { validatePedagogicalContent } from './validation/pedagogical-validation'

const log = logger.child('hl-agent-loop')

export type ProviderConfig = Pick<
  LLMCallOptions,
  'provider' | 'model' | 'apiKey' | 'baseUrl' | 'numCtx' | 'numGpu'
>

export interface AgentLoopOptions {
  systemPrompt: string
  taskDescription: string
  /** Tools reales con execute() — se convierten a LLMToolDef internamente */
  tools: Tool[]
  providerConfig: ProviderConfig
  maxIterations?: number
  maxTokens?: number
  temperature?: number
  /** Contexto para validación pedagógica */
  validationContext?: {
    agenteId: string
    rangoEdad?: string
    tema?: string
    nodoId?: string
  }
}

/** Convierte un Tool local a LLMToolDef para pasarlo al LLM */
function toToolDef(t: Tool): LLMToolDef {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters as Record<string, unknown>,
    },
  }
}

/**
 * Determina si el resultado de execute() es solo un eco de los params de entrada.
 * Estas tools actúan como "structured output schemas" — los args del tool_call
 * son el resultado final, no la respuesta de execute().
 */
function isPassthrough(result: unknown, params: Record<string, unknown>): boolean {
  if (typeof result !== 'object' || result === null) return false
  const r = result as Record<string, unknown>
  if (!r.ok) return false
  if (!('output' in r)) return false
  return JSON.stringify(r.output) === JSON.stringify(params)
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<string> {
  const maxIter = opts.maxIterations ?? 6
  const toolDefs: LLMToolDef[] = opts.tools.map(toToolDef)

  const messages: LLMMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.taskDescription },
  ]

  for (let i = 0; i < maxIter; i++) {
    const response = await callLLM({
      ...opts.providerConfig,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      maxTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.3,
    })

    if (response.stop_reason === 'error') {
      throw new Error(response.content)
    }

    // Sin tool_calls → respuesta de texto final
    if (!response.tool_calls?.length || response.stop_reason !== 'tool_calls') {
      return response.content
    }

    const toolCall = response.tool_calls[0]
    const tool = opts.tools.find(t => t.name === toolCall.function.name)

    let parsedArgs: Record<string, unknown>
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments)
    } catch {
      parsedArgs = {}
    }

    // Sin execute() → structured output, retornar args como resultado final
    if (!tool?.execute) {
      log.info(`[agent-loop] structured output via tool=${toolCall.function.name}`)
      return toolCall.function.arguments
    }

    // Con execute() → ejecutar la tool
    const execResult = await tool.execute(parsedArgs)

    // Validación pedagógica después de ejecutar la tool
    if (opts.validationContext) {
      try {
        const validationResult = validatePedagogicalContent(parsedArgs, {
          agenteId: opts.validationContext.agenteId,
          rangoEdad: opts.validationContext.rangoEdad || 'adulto',
          tema: opts.validationContext.tema || '',
          tipoContenido: toolCall.function.name,
        })
        
        log.info(`[agent-loop] validation for ${toolCall.function.name}: approved=${validationResult.aprobado}`)
        
        // Si la validación falla, registrar observaciones
        if (!validationResult.aprobado) {
          log.warn(`[agent-loop] validation failed for ${toolCall.function.name}: ${validationResult.observaciones.join(', ')}`)
        }
      } catch (validationError) {
        log.warn(`[agent-loop] validation error for ${toolCall.function.name}: ${(validationError as Error).message}`)
      }
    }

    // Passthrough: execute solo eco de params → args son el output estructurado final
    if (isPassthrough(execResult, parsedArgs)) {
      log.info(`[agent-loop] passthrough tool=${toolCall.function.name}`)
      return toolCall.function.arguments
    }

    // Tool real: alimentar resultado al LLM y continuar loop
    const resultStr = typeof execResult === 'string' ? execResult : JSON.stringify(execResult)
    log.info(`[agent-loop] tool=${toolCall.function.name} result_len=${resultStr.length}`)

    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls,
    })
    messages.push({
      role: 'tool',
      content: resultStr,
      tool_call_id: toolCall.id,
    })
  }

  // Agotadas las iteraciones — último mensaje útil del historial
  const last = messages.findLast(m => m.role === 'assistant')
  return last?.content ?? ''
}
