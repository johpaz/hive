/**
 * HiveLearnExecutor — puente entre DAGScheduler y runHiveLearnAgent.
 * Guarda el output de cada agente en hl_session_agent_outputs para trazabilidad.
 */
import type { TaskNode } from '../scheduler/dag'
import { runHiveLearnAgent } from './runner'
import { AGENT_PROMPTS } from './prompts'
import { AGENT_EXECUTABLE_TOOLS } from './tool-map'
import { LessonPersistence } from '../persistence/LessonPersistence'
import { nodeCache } from '../cache/NodeCache'

const DEFAULT_PROMPT = 'Eres un agente educativo de HiveLearn. Responde en JSON estructurado.'

/** Extrae metadatos del taskDescription para usar como cache key */
function extractCacheKey(taskDesc: string): { conceptoSlug: string; nivel: string; rangoEdad: string } | null {
  const concepto = taskDesc.match(/Concepto: "([^"]+)"/)?.[1]
  const nivel = taskDesc.match(/Nivel: (\S+)/)?.[1]?.replace('.', '')
  const rangoEdad = taskDesc.match(/Rango edad: (\S+)/)?.[1]?.replace('.', '')
  if (!concepto || !nivel || !rangoEdad) return null
  const conceptoSlug = concepto.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40)
  return { conceptoSlug, nivel, rangoEdad }
}

/** Extrae contexto de validación del taskDescription */
function extractValidationContext(taskDesc: string): {
  rangoEdad?: string
  tema?: string
  nodoId?: string
} {
  const rangoEdad = taskDesc.match(/Rango edad: (\S+)/)?.[1]?.replace('.', '')
  const tema = taskDesc.match(/Meta: "([^"]+)"/)?.[1] || 
               taskDesc.match(/Tema: "([^"]+)"/)?.[1]
  const nodoId = taskDesc.match(/Nodo: "([^"]+)"/)?.[1]
  
  return {
    rangoEdad,
    tema,
    nodoId,
  }
}

export class HiveLearnExecutor {
  private persistence: LessonPersistence

  constructor() {
    this.persistence = new LessonPersistence()
  }

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

    // ── Node cache (solo para agentes de contenido/visual) ──────────────
    const isCacheable = node.id.startsWith('content-') || node.id.startsWith('visual-')
    if (isCacheable) {
      const meta = extractCacheKey(node.taskDescription)
      if (meta) {
        const cached = nodeCache.get(node.agentId, meta.conceptoSlug, meta.nivel, meta.rangoEdad)
        if (cached) {
          nodeCache.hit(node.agentId, meta.conceptoSlug, meta.nivel, meta.rangoEdad)
          this.persistence.saveAgentOutput(threadId, node.agentId, node.id, cached.outputJson, 0, 'ok')
          return cached.outputJson
        }
      }
    }

    const t0 = Date.now()
    let output = ''
    let status: 'ok' | 'failed' = 'ok'

    try {
      // Extraer contexto de validación del taskDescription
      const validationContext = extractValidationContext(node.taskDescription)
      
      output = await runHiveLearnAgent({
        agentId: node.agentId,
        taskDescription: node.taskDescription + contextBlock,
        systemPrompt,
        tools,
        threadId,
        validationContext,
      })
    } catch (err) {
      status = 'failed'
      output = JSON.stringify({ error: (err as Error).message })
      throw err
    } finally {
      const durationMs = Date.now() - t0
      this.persistence.saveAgentOutput(threadId, node.agentId, node.id, output, durationMs, status)
      // Guardar en cache si fue exitoso y es cacheable
      if (status === 'ok' && isCacheable && output) {
        const meta = extractCacheKey(node.taskDescription)
        if (meta) nodeCache.set(node.agentId, meta.conceptoSlug, meta.nivel, meta.rangoEdad, output)
      }
    }

    return output
  }
}
