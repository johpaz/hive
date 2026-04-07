/**
 * HiveLearnSwarm — único punto de entrada al enjambre.
 * Orquesta el DAGScheduler, gestiona el progreso y devuelve el LessonProgram.
 */
import { DAGScheduler } from '../scheduler/dag'
import { TaskNode } from '../scheduler/dag/TaskNode'
import { HiveLearnExecutor } from '../agent/executor'
import { runHiveLearnAgent } from '../agent/runner'
import { buildBaseDAG, buildFullDAG } from './presets/HiveLearnPreset'
import { buildLessonProgram, parseAgentOutput, buildNodosBase } from './orchestrator'
import { AGENT_IDS } from '../agents/registry'
import { AGENT_PROMPTS } from '../agent/prompts'
import { AGENT_EXECUTABLE_TOOLS } from '../agent/tool-map'
import { logger } from '../utils/logger'
import { LessonPersistence } from '../persistence/LessonPersistence'
import type { DAGResult } from '../scheduler/dag'
import type { TaskGraph } from '../scheduler/dag/TaskGraph'
import type { StudentProfile, PerfilAdaptacion, LessonProgram, SwarmProgress, NodoLesson } from '../types'

const log = logger.child('hl-swarm')

const MAX_WORKERS = Number(process.env.HIVELEARN_MAX_CONCURRENT_WORKERS ?? 2)
const DEBUG_DAG = process.env.HIVELEARN_DEBUG_DAG === 'true'

export type ProgressCallback = (progress: SwarmProgress) => void

export class HiveLearnSwarm {
  private onProgress?: ProgressCallback

  constructor(opts?: { onProgress?: ProgressCallback }) {
    this.onProgress = opts?.onProgress
  }

  private emit(etapa: string, agenteActivo: string, porcentaje: number, mensaje: string) {
    this.onProgress?.({ etapa, agenteActivo, porcentaje, mensaje })
  }

  async run(perfil: StudentProfile, meta: string): Promise<LessonProgram> {
    const ts = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14) // YYYYMMDDHHmmss
    const nombreSlug = perfil.nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 20)
    const sessionId = `${nombreSlug}_${ts}`

    const perfilAdaptacion: PerfilAdaptacion = {
      rangoEdad: perfil.rangoEdad,
      duracionSesion: perfil.tiempoSesion,
      nodosRecomendados: this.calcNodos(perfil),
      estilo: perfil.estilo,
      nivelPrevio: perfil.nivelPrevio,
      tono: this.calcTono(perfil),
    }

    this.emit('tier0', 'ProfileAgent', 5, 'Analizando tu perfil de aprendizaje...')

    // Consultar datos de efectividad previos para informar al StructureAgent
    const persistence = new LessonPersistence()
    let efectividadCtx = ''
    try {
      const intentSlug = meta.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 30)
      const efectividad = persistence.getTopicEffectiveness(intentSlug)
      if (efectividad.nodosConMasFallas.length > 0) {
        efectividadCtx = `\nDATOS DE SESIONES PREVIAS sobre este tema: tasa aprobación promedio ${efectividad.nivelPromedioAprobacion}%. Tipos de nodos con más dificultad: ${efectividad.nodosConMasFallas.join(', ')}. Considera agregar más nodos de práctica para estos tipos.`
      }
    } catch { /* non-critical */ }

    // Executor compartido entre ambas fases y los retries del coordinador
    const executor = new HiveLearnExecutor()

    // FASE 1: Ejecutar Tier 0 (profile → intent → structure) para obtener los nodos
    const baseDAGInput = { alumnoId: perfil.alumnoId, meta: meta + efectividadCtx, perfil: perfilAdaptacion, sessionId }
    const baseGraph = buildBaseDAG(baseDAGInput)

    const schedulerBase = new DAGScheduler({
      maxConcurrentWorkers: 1,  // Tier 0 es secuencial
      silent: !DEBUG_DAG,
      executor,
      coordinatorId: AGENT_IDS.coordinator,
    })

    this.emit('tier0', 'IntentAgent', 15, 'Entendiendo lo que quieres aprender...')

    const baseResult = await schedulerBase.execute(baseGraph)

    this.emit('tier0', 'StructureAgent', 30, 'Diseñando tu programa personalizado...')

    // Extraer nodos del StructureAgent
    const structureNode = baseResult.completed.find(n => n.id === 'structure')
    let nodosBase: NodoLesson[] = []

    if (structureNode?.result) {
      const estructuraNodos = buildNodosBase(structureNode.result, perfilAdaptacion)
      
      nodosBase = estructuraNodos.map((n, idx) => ({
        ...n,
        posX: 100 + idx * 300,
        posY: 100 + (idx % 2) * 180,
      }))
    }

    this.emit('tier1', 'ContentAgents', 35, `Generando contenido para ${nodosBase.length} nodos en paralelo...`)

    // FASE 2: Ejecutar grafo completo con nodos conocidos
    const fullGraph = buildFullDAG(baseDAGInput, nodosBase)
    const schedulerFull = new DAGScheduler({
      maxConcurrentWorkers: MAX_WORKERS,
      silent: !DEBUG_DAG,
      executor,
      coordinatorId: AGENT_IDS.coordinator,
    })

    const fullResult = await schedulerFull.execute(fullGraph)

    this.emit('tier2', 'GamificationAgent', 85, 'Configurando logros y gamificación...')
    this.emit('post', 'Orchestrator', 95, 'Ensamblando tu lección...')

    const program = buildLessonProgram({
      dagResult: fullResult,
      alumnoId: perfil.alumnoId,
      meta,
      sessionId,
      perfil: perfilAdaptacion,
    })

    this.emit('review', 'Coordinator', 97, 'Coordinador revisando coherencia pedagógica...')

    // Construir mapa de outputs raw para que el coordinador tenga acceso completo
    const rawOutputs = new Map<string, string>()
    for (const n of [...fullResult.completed, ...fullResult.failed]) {
      if (n.result) rawOutputs.set(n.id, n.result)
    }

    const reviewed = await this.runCoordinatorReview(
      program, meta, sessionId, rawOutputs, fullResult, fullGraph, executor,
    )

    this.emit('complete', 'HiveLearn', 100, '¡Tu lección está lista! 🐝')

    return reviewed
  }

  /** El coordinador revisa el LessonProgram y aplica correcciones + retries si los hay. */
  private async runCoordinatorReview(
    program: LessonProgram,
    meta: string,
    sessionId: string,
    rawOutputs: Map<string, string>,
    fullResult: DAGResult,
    fullGraph: TaskGraph,
    executor: HiveLearnExecutor,
  ): Promise<LessonProgram> {
    try {
      // Resumen de raw outputs para contexto del coordinador
      const rawSummary = [...rawOutputs.entries()]
        .filter(([k]) => ['intent', 'profile', 'gamification'].includes(k) || k.startsWith('content-'))
        .map(([k, v]) => `${k}: ${v.slice(0, 200)}`)
        .join('\n')

      const taskDescription = `Revisa el siguiente LessonProgram generado por el enjambre para la meta: "${meta}"

${rawSummary ? `OUTPUTS DE AGENTES CLAVE (primeros 200 chars cada uno):\n${rawSummary}\n\n` : ''}LESSON PROGRAM:
${JSON.stringify({
  tema: program.tema,
  rangoEdad: program.rangoEdad,
  nodos: program.nodos.map(n => ({
    id: n.id,
    titulo: n.titulo,
    tipoPedagogico: n.tipoPedagogico,
    tipoVisual: n.tipoVisual,
    xpRecompensa: n.xpRecompensa,
    tieneContenido: Object.keys(n.contenido ?? {}).length > 0,
  })),
  totalNodos: program.nodos.length,
  gamificacion: program.gamificacion,
  evaluacion: { totalPreguntas: program.evaluacion?.preguntas?.length ?? 0 },
}, null, 2)}`

      const raw = await runHiveLearnAgent({
        agentId: AGENT_IDS.coordinator,
        taskDescription,
        systemPrompt: AGENT_PROMPTS[AGENT_IDS.coordinator] ?? '',
        tools: AGENT_EXECUTABLE_TOOLS[AGENT_IDS.coordinator] ?? [],
        threadId: sessionId,
      })

      const revision = parseAgentOutput<{
        aprobado?: boolean
        calidad?: number
        issues?: string[]
        correcciones?: Record<string, Partial<{ titulo: string; xpRecompensa: number; concepto: string }>>
        suggestedRetries?: string[]
        mensaje?: string
      }>(raw, {})

      log.info(`[coordinator] calidad=${revision.calidad ?? '?'} aprobado=${revision.aprobado ?? '?'} mensaje="${revision.mensaje ?? ''}"`)

      if (revision.issues?.length) {
        log.warn(`[coordinator] issues: ${revision.issues.join(' | ')}`)
      }

      // ── Retries sugeridos por el coordinador ─────────────────────────────
      const retryIds = (revision.suggestedRetries ?? [])
        .filter(id => fullGraph.nodes.has(id))   // solo IDs válidos
        .slice(0, 3)                              // máximo 3

      if (retryIds.length > 0) {
        log.info(`[coordinator] retrying ${retryIds.length} task(s): ${retryIds.join(', ')}`)
        this.emit('review', 'Coordinator', 98, `Re-ejecutando ${retryIds.length} nodo(s) con contenido vacío...`)

        // Clonar el mapa de outputs para no mutar el original
        const updatedOutputs = new Map(rawOutputs)

        for (const taskId of retryIds) {
          const graphNode = fullGraph.nodes.get(taskId)!
          // Crear un TaskNode fresco reutilizando la config del grafo
          const freshNode = new TaskNode({
            id: graphNode.id,
            agentId: graphNode.agentId,
            name: graphNode.name,
            taskDescription: graphNode.taskDescription,
            deps: graphNode.deps,
            timeout: graphNode.timeout,
            maxRetries: 1,
            priority: graphNode.priority,
          })
          try {
            const newOutput = await executor.execute(freshNode, {}, sessionId)
            updatedOutputs.set(taskId, newOutput)
            log.info(`[coordinator] retry ok: ${taskId}`)
          } catch (retryErr) {
            log.warn(`[coordinator] retry failed: ${taskId} — ${(retryErr as Error).message}`)
          }
        }

        // Re-ensamblar el programa con los outputs actualizados
        const updatedDagResult: DAGResult = {
          ...fullResult,
          completed: [
            ...fullResult.completed.filter(n => !retryIds.includes(n.id)),
            ...retryIds
              .filter(id => updatedOutputs.has(id))
              .map(id => ({
                id,
                name: fullGraph.nodes.get(id)!.name,
                status: 'COMPLETED' as const,
                durationMs: 0,
                result: updatedOutputs.get(id),
                retries: 1,
              })),
          ],
        }

        const updatedProgram = buildLessonProgram({
          dagResult: updatedDagResult,
          alumnoId: program.alumnoId,
          meta,
          sessionId,
          perfil: program.perfilAdaptacion,
        })

        // Aplicar correcciones sobre el programa actualizado
        return this.applyCorrecciones(updatedProgram, revision.correcciones)
      }

      // ── Sin retries: solo correcciones menores ───────────────────────────
      return this.applyCorrecciones(program, revision.correcciones)
    } catch (err) {
      // La revisión no es crítica — si falla, devolver el programa sin cambios
      log.warn(`[coordinator] review skipped: ${(err as Error).message}`)
      return program
    }
  }

  /** Aplica correcciones de título/XP/concepto a los nodos del programa. */
  private applyCorrecciones(
    program: LessonProgram,
    correcciones?: Record<string, Partial<{ titulo: string; xpRecompensa: number; concepto: string }>>,
  ): LessonProgram {
    if (!correcciones || Object.keys(correcciones).length === 0) return program
    const correctedNodos = program.nodos.map(nodo => {
      const fix = correcciones[nodo.id]
      return fix ? { ...nodo, ...fix } : nodo
    })
    log.info(`[coordinator] applied corrections to ${Object.keys(correcciones).length} node(s)`)
    return { ...program, nodos: correctedNodos }
  }

  private calcNodos(perfil: StudentProfile): number {
    const map = { nino: 5, adolescente: 8, adulto: 10 }
    return map[perfil.rangoEdad] ?? 8
  }

  private calcTono(perfil: StudentProfile): string {
    const map = { nino: 'amigable', adolescente: 'motivador', adulto: 'técnico' }
    return map[perfil.rangoEdad] ?? 'neutro'
  }
}
