import type { Tool } from '../../types/tool'
import { buildFullDAG } from '../../swarm/presets/HiveLearnPreset'
import { DAGScheduler } from '../../scheduler/dag'
import { HiveLearnExecutor } from '../../agent/executor'
import { buildLessonProgram } from '../../swarm/orchestrator'
import { buildNodosBase } from '../../swarm/orchestrator'
import { AGENT_IDS } from '../../agents/registry'
import type { PerfilAdaptacion, LessonProgram, NodoLesson } from '../../types'

/**
 * Tool del Coordinador para delegar al enjambre de workers.
 * Ejecuta el DAGScheduler con los workers seleccionados y devuelve el LessonProgram.
 */
export const delegarEnjambreTool: Tool = {
  name: 'delegar_a_enjambre',
  description: 'Delega tareas al enjambre de agentes especializados. Ejecuta los workers en paralelo según el grafo DAG y devuelve el LessonProgram ensamblado.',
  parameters: {
    type: 'object',
    properties: {
      alumnoId: {
        type: 'string',
        description: 'ID único del alumno',
      },
      meta: {
        type: 'string',
        description: 'Meta de aprendizaje del alumno',
      },
      perfil: {
        type: 'object',
        description: 'Perfil de adaptación del alumno',
        properties: {
          rangoEdad: { type: 'string', enum: ['nino', 'adolescente', 'adulto'] },
          nivelPrevio: { type: 'string', enum: ['principiante', 'principiante_base', 'intermedio'] },
          duracionSesion: { type: 'number' },
          nodosRecomendados: { type: 'number' },
          estilo: { type: 'string' },
          tono: { type: 'string' },
        },
        required: ['rangoEdad', 'nivelPrevio', 'duracionSesion', 'estilo', 'tono'],
      },
      sessionId: {
        type: 'string',
        description: 'ID de sesión único',
      },
      workers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de worker IDs a ejecutar (ej: ["hl-explanation-agent", "hl-exercise-agent"])',
      },
    },
    required: ['alumnoId', 'meta', 'perfil', 'sessionId'],
  },
  execute: async (params: {
    alumnoId: string
    meta: string
    perfil: PerfilAdaptacion
    sessionId: string
    workers?: string[]
  }): Promise<{ ok: boolean; output: LessonProgram | { error: string } }> => {
    try {
      const { alumnoId, meta, perfil, sessionId } = params

      // Fase 1: Ejecutar Tier 0 (profile → intent → structure) secuencialmente
      const ctxBase = `Alumno: ${alumnoId}. Rango edad: ${perfil.rangoEdad}. Nivel: ${perfil.nivelPrevio}. Tono: ${perfil.tono}.`

      // Structure para obtener nodos base
      const structureResult = await executeWorker(AGENT_IDS.structure, sessionId, ctxBase, meta, perfil)
      const nodosBaseRaw = buildNodosBase(structureResult, perfil)
      const nodosBase: NodoLesson[] = nodosBaseRaw.map((n, idx) => ({
        ...n,
        posX: 100 + idx * 300,
        posY: 100 + (idx % 2) * 180,
      }))

      // Fase 2: Ejecutar grafo completo con content workers
      const fullGraph = buildFullDAG({ alumnoId, meta, perfil, sessionId }, nodosBase)
      const scheduler = new DAGScheduler({
        maxConcurrentWorkers: 2,
        silent: false,
        executor: new HiveLearnExecutor(),
        coordinatorId: AGENT_IDS.coordinator,
      })

      const fullResult = await scheduler.execute(fullGraph)

      // Ensamblar LessonProgram
      const program = buildLessonProgram({
        dagResult: fullResult,
        alumnoId,
        meta,
        sessionId,
        perfil,
      })

      return { ok: true, output: program }
    } catch (err) {
      return { ok: false, output: { error: (err as Error).message } }
    }
  },
}

async function executeWorker(
  agentId: string,
  sessionId: string,
  ctxBase: string,
  meta: string,
  perfil: PerfilAdaptacion
): Promise<string> {
  const { runHiveLearnAgent } = await import('../../agent/runner')
  const { AGENT_PROMPTS } = await import('../../agent/prompts')
  const { AGENT_EXECUTABLE_TOOLS } = await import('../../agent/tool-map')

  const taskDescription = `${ctxBase}\nMeta: "${meta}"\nDiseña el programa de estudio.`

  return runHiveLearnAgent({
    agentId,
    taskDescription,
    systemPrompt: AGENT_PROMPTS[agentId] ?? '',
    tools: AGENT_EXECUTABLE_TOOLS[agentId] ?? [],
    threadId: sessionId,
  })
}
