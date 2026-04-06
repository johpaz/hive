/**
 * HiveLearnSwarm — único punto de entrada al enjambre.
 * Orquesta el DAGScheduler, gestiona el progreso y devuelve el LessonProgram.
 */
import { DAGScheduler } from '../scheduler/dag'
import { HiveLearnExecutor } from '../agent/executor'
import { runHiveLearnAgent } from '../agent/runner'
import { buildBaseDAG, buildFullDAG } from './presets/HiveLearnPreset'
import { buildLessonProgram, parseAgentOutput } from './orchestrator'
import { nodeCache } from '../cache/NodeCache'
import { AGENT_IDS } from '../agents/registry'
import { AGENT_PROMPTS } from '../agent/prompts'
import { AGENT_EXECUTABLE_TOOLS } from '../agent/tool-map'
import { logger } from '../utils/logger'
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
    const sessionId = crypto.randomUUID()

    const perfilAdaptacion: PerfilAdaptacion = {
      rangoEdad: perfil.rangoEdad,
      duracionSesion: perfil.tiempoSesion,
      nodosRecomendados: this.calcNodos(perfil),
      estilo: perfil.estilo,
      nivelPrevio: perfil.nivelPrevio,
      tono: this.calcTono(perfil),
    }

    this.emit('tier0', 'ProfileAgent', 5, 'Analizando tu perfil de aprendizaje...')

    // FASE 1: Ejecutar Tier 0 (profile → intent → structure) para obtener los nodos
    const baseDAGInput = { alumnoId: perfil.alumnoId, meta, perfil: perfilAdaptacion, sessionId }
    const baseGraph = buildBaseDAG(baseDAGInput)

    const schedulerBase = new DAGScheduler({
      maxConcurrentWorkers: 1,  // Tier 0 es secuencial
      silent: !DEBUG_DAG,
      executor: new HiveLearnExecutor(),
      coordinatorId: AGENT_IDS.coordinator,
    })

    this.emit('tier0', 'IntentAgent', 15, 'Entendiendo lo que quieres aprender...')

    const baseResult = await schedulerBase.execute(baseGraph)

    this.emit('tier0', 'StructureAgent', 30, 'Diseñando tu programa personalizado...')

    // Extraer nodos del StructureAgent
    const structureNode = baseResult.completed.find(n => n.id === 'structure')
    let nodosBase: NodoLesson[] = []

    if (structureNode?.result) {
      const rawParsed = parseAgentOutput<any>(structureNode.result, { nodos: [] })
      // Desenvuelve wrapper {ok, output} que devuelven las passthrough tools
      const parsed = (rawParsed?.ok === true && rawParsed?.output != null) ? rawParsed.output : rawParsed
      nodosBase = (parsed.nodos ?? []).map((n: any, idx: number) => ({
        id: n.id ?? `nodo-${idx}`,
        tipoPedagogico: n.tipoPedagogico ?? n.tipo_pedagogico ?? 'concept',
        tipoVisual: n.tipoVisual ?? n.tipo_visual ?? 'text_card',
        titulo: n.titulo ?? `Nodo ${idx + 1}`,
        concepto: n.concepto ?? '',
        nivel: perfilAdaptacion.nivelPrevio,
        rangoEdad: perfilAdaptacion.rangoEdad,
        estado: idx === 0 ? 'disponible' : 'bloqueado',
        xpRecompensa: n.xpRecompensa ?? n.xp_recompensa ?? 20,
        posX: 100 + idx * 300,
        posY: 100 + (idx % 2) * 180,
        contenido: {},
      })) as NodoLesson[]
    }

    this.emit('tier1', 'ContentAgents', 35, `Generando contenido para ${nodosBase.length} nodos en paralelo...`)

    // FASE 2: Ejecutar grafo completo con nodos conocidos
    const fullGraph = buildFullDAG(baseDAGInput, nodosBase)
    const schedulerFull = new DAGScheduler({
      maxConcurrentWorkers: MAX_WORKERS,
      silent: !DEBUG_DAG,
      executor: new HiveLearnExecutor(),
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

    const reviewed = await this.runCoordinatorReview(program, meta, sessionId)

    this.emit('complete', 'HiveLearn', 100, '¡Tu lección está lista! 🐝')

    return reviewed
  }

  /** El coordinador revisa el LessonProgram y aplica correcciones menores si las hay. */
  private async runCoordinatorReview(program: LessonProgram, meta: string, sessionId: string): Promise<LessonProgram> {
    try {
      const taskDescription = `Revisa el siguiente LessonProgram generado por el enjambre para la meta: "${meta}"

LESSON PROGRAM:
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
        mensaje?: string
      }>(raw, {})

      log.info(`[coordinator] calidad=${revision.calidad ?? '?'} aprobado=${revision.aprobado ?? '?'} mensaje="${revision.mensaje ?? ''}"`)

      if (revision.issues?.length) {
        log.warn(`[coordinator] issues: ${revision.issues.join(' | ')}`)
      }

      // Aplicar correcciones menores si las hay
      if (revision.correcciones && Object.keys(revision.correcciones).length > 0) {
        const correctedNodos = program.nodos.map(nodo => {
          const fix = revision.correcciones![nodo.id]
          if (!fix) return nodo
          return { ...nodo, ...fix }
        })
        log.info(`[coordinator] applied corrections to ${Object.keys(revision.correcciones).length} node(s)`)
        return { ...program, nodos: correctedNodos }
      }

      return program
    } catch (err) {
      // La revisión no es crítica — si falla, devolver el programa sin cambios
      log.warn(`[coordinator] review skipped: ${(err as Error).message}`)
      return program
    }
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
