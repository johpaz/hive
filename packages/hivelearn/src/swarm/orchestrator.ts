/**
 * Orchestrator — combina los outputs del DAGScheduler en un LessonProgram completo
 */
import type { DAGResult } from '../scheduler/dag'
import type {
  LessonProgram, NodoLesson, NodoContenido, GamificacionOutput, EvaluacionOutput,
  PerfilAdaptacion, RangoEdad, TipoPedagogico, TipoVisual, EstadoNodo, NivelPrevio
} from '../types'
import { nodeCache } from '../cache/NodeCache'
import { logger } from '../utils/logger'

const log = logger.child('orchestrator')

export function parseAgentOutput<T>(raw: string, fallback: T): T {
  try {
    // Find the first complete JSON object (handles nested braces)
    const start = raw.indexOf('{')
    if (start === -1) {
      const arrStart = raw.indexOf('[')
      if (arrStart === -1) return fallback
      // For arrays, find matching ]
      let depth = 0
      for (let i = arrStart; i < raw.length; i++) {
        if (raw[i] === '[') depth++
        if (raw[i] === ']') depth--
        if (depth === 0) return JSON.parse(raw.slice(arrStart, i + 1)) as T
      }
      return fallback
    }

    // For objects, find matching }
    let depth = 0
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++
      if (raw[i] === '}') depth--
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1)) as T
    }
    return fallback
  } catch {
    return fallback
  }
}

/** Calcula posiciones x/y para cada nodo (layout árbol izquierda-derecha) */
function calcularPosiciones(nodos: Omit<NodoLesson, 'posX' | 'posY'>[]): NodoLesson[] {
  const LEVEL_WIDTH = 300
  const NODE_HEIGHT = 180
  const START_X = 100

  return nodos.map((nodo, idx) => ({
    ...nodo,
    posX: START_X + idx * LEVEL_WIDTH,
    posY: 100 + (idx % 2) * NODE_HEIGHT,
  }))
}

/** Desenvuelve el wrapper {ok, output} que devuelven las passthrough tools */
function unwrap(parsed: any): any {
  if (parsed && typeof parsed === 'object' && 'ok' in parsed && 'output' in parsed) {
    return parsed.output
  }
  return parsed
}

/** Construye la lista de nodos base desde el output de StructureAgent */
export function buildNodosBase(structureResult: string, perfil: PerfilAdaptacion): Omit<NodoLesson, 'posX' | 'posY'>[] {
  const raw = parseAgentOutput<any>(structureResult, { nodos: [] })
  const parsed = unwrap(raw)
  const estructuraNodos = parsed.nodos ?? []

  log.info(`[buildNodosBase] ${estructuraNodos.length} nodos`)

  return estructuraNodos.map((n, idx) => {
    return {
      id: `nodo-${idx}`,
      tipoPedagogico: (n.tipo_pedagogico ?? n.tipoPedagogico ?? 'concept') as TipoPedagogico,
      tipoVisual: (n.tipo_visual ?? n.tipoVisual ?? 'text_card') as TipoVisual,
      titulo: n.titulo ?? `Nodo ${idx + 1}`,
      concepto: n.concepto ?? '',
      nivel: perfil.nivelPrevio as NivelPrevio,
      rangoEdad: perfil.rangoEdad as RangoEdad,
      estado: (idx === 0 ? 'disponible' : 'bloqueado') as EstadoNodo,
      xpRecompensa: n.xp_recompensa ?? n.xpRecompensa ?? 20,
      contenido: {} as NodoContenido,
    }
  })
}

/** Enriquece los nodos con el contenido generado por los agentes Tier 1 */
function enriquecerNodos(
  nodos: Omit<NodoLesson, 'posX' | 'posY'>[],
  dagResult: DAGResult,
): Omit<NodoLesson, 'posX' | 'posY'>[] {
  const resultMap = new Map<string, string>()
  for (const node of [...dagResult.completed, ...dagResult.failed]) {
    if (node.result) resultMap.set(node.id, node.result)
  }

  log.info(`[enriquecerNodos] keys: ${[...resultMap.keys()].join(', ')}`)

  return nodos.map(nodo => {
    const contentKey = `content-${nodo.id}`
    const visualKey = `visual-${nodo.id}`
    const contenido: NodoContenido = {}

    const contentRaw = resultMap.get(contentKey)
    if (contentRaw) {
      const parsed = unwrap(parseAgentOutput<any>(contentRaw, null))
      if (parsed) {
        if (parsed.microEval) contenido.microEval = parsed.microEval
        switch (nodo.tipoPedagogico) {
          case 'concept':   contenido.explicacion  = parsed; break
          case 'exercise':  contenido.ejercicio    = parsed; break
          case 'quiz':      contenido.quiz         = parsed; break
          case 'challenge': contenido.reto         = parsed; break
          case 'evaluation':contenido.evaluacion   = parsed; break
          default:          contenido.explicacion  = parsed; break
        }
      }
    } else {
      log.warn(`[enriquecerNodos] missing content for key="${contentKey}" (nodo.id=${nodo.id})`)
    }

    const visualRaw = resultMap.get(visualKey)
    if (visualRaw) {
      const parsed = unwrap(parseAgentOutput<any>(visualRaw, null))
      if (parsed) {
        switch (nodo.tipoVisual) {
          case 'code_block':  contenido.codigo    = parsed; break
          case 'svg_diagram': contenido.svg       = parsed; break
          case 'gif_guide':   contenido.gifFrames = parsed; break
          case 'infographic': contenido.infografia= parsed; break
          case 'image_ai':    contenido.imagen    = parsed; break
          case 'audio_ai':    contenido.audio     = parsed; break
        }
      }
    }

    return { ...nodo, contenido }
  })
}

/** Aplica redistribución de XP del coordinador a los nodos */
export function aplicarRedistribucionXP(
  nodos: NodoLesson[],
  xpRedistribuido?: Record<string, number>
): NodoLesson[] {
  if (!xpRedistribuido || Object.keys(xpRedistribuido).length === 0) {
    return nodos
  }

  log.info(`[aplicarRedistribucionXP] aplicando redistribución a ${Object.keys(xpRedistribuido).length} nodos`)
  
  return nodos.map(nodo => {
    const xpNuevo = xpRedistribuido[nodo.id]
    if (xpNuevo !== undefined) {
      log.info(`[aplicarRedistribucionXP] nodo ${nodo.id}: ${nodo.xpRecompensa} → ${xpNuevo}`)
      return { ...nodo, xpRecompensa: xpNuevo }
    }
    return nodo
  })
}

export function buildLessonProgram(opts: {
  dagResult: DAGResult
  alumnoId: string
  meta: string
  sessionId: string
  perfil: PerfilAdaptacion
  xpRedistribuido?: Record<string, number>
}): LessonProgram {
  const { dagResult, alumnoId, meta, sessionId, perfil, xpRedistribuido } = opts

  const resultMap = new Map<string, string>()
  for (const n of [...dagResult.completed, ...dagResult.failed]) {
    if (n.result) resultMap.set(n.id, n.result)
  }

  // Construir nodos desde StructureAgent
  const structureRaw = resultMap.get('structure') ?? '{}'
  const nodosBase = buildNodosBase(structureRaw, perfil)
  const nodosEnriquecidos = enriquecerNodos(nodosBase, dagResult)
  let nodos = calcularPosiciones(nodosEnriquecidos)

  // Aplicar redistribución de XP del coordinador si existe
  if (xpRedistribuido) {
    nodos = aplicarRedistribucionXP(nodos, xpRedistribuido)
  }

  // Gamificación — puede ser JSON libre (sin tool) o passthrough wrapper
  const gamRaw = resultMap.get('gamification') ?? '{}'
  const gamificacion = unwrap(parseAgentOutput<GamificacionOutput>(gamRaw, {
    xpRecompensa: 100,
    logros: [],
    mensajeCelebracion: '¡Excelente trabajo! Completaste la lección. 🎉',
  })) as GamificacionOutput

  // Evaluación — passthrough wrapper {ok, output: {preguntas}}
  const evalRaw = resultMap.get('evaluation') ?? '{}'
  const evaluacion = unwrap(parseAgentOutput<EvaluacionOutput>(evalRaw, { preguntas: [] })) as EvaluacionOutput

  // Extraer tema desde el output de intent — puede ser passthrough
  const intentRaw = resultMap.get('intent') ?? '{}'
  const intent = unwrap(parseAgentOutput<{ tema?: string; topicSlug?: string | null }>(intentRaw, {}))

  return {
    sessionId,
    alumnoId,
    tema: intent.tema ?? meta,
    topicSlug: intent.topicSlug ?? null,
    rangoEdad: perfil.rangoEdad,
    nodos,
    gamificacion,
    evaluacion,
    perfilAdaptacion: perfil,
  }
}
