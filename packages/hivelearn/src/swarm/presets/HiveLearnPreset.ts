/**
 * HiveLearnPreset — DAG completo de 14 agentes para HiveLearn
 *
 * TIER 0 (secuencial):  profile → intent → structure
 * TIER 1 (paralelo×2):  content agents por nodo del currículo
 * TIER 2 (paralelo):    gamification + evaluation + position
 * POST:                 postsession
 */
import { TaskGraph } from '../../scheduler/dag'
import type { TaskNodeConfig } from '../../scheduler/dag'
import { AGENT_IDS } from '../../agents/registry'
import type { PerfilAdaptacion, NodoLesson, RangoEdad } from '../../types'

export interface HiveLearnDAGInput {
  alumnoId: string
  meta: string
  perfil: PerfilAdaptacion
  sessionId: string
}

/**
 * Genera el grafo DAG para el enjambre completo.
 * Los nodos de contenido (Tier 1) se agregan dinámicamente cuando
 * el StructureAgent completa y el orchestrator ya tiene los nodos.
 * Esta función genera el grafo base (Tier 0 + Tier 2).
 */
export function buildBaseDAG(input: HiveLearnDAGInput): TaskGraph {
  const ctxBase = `Alumno: ${input.alumnoId}. Rango edad: ${input.perfil.rangoEdad}. Nivel: ${input.perfil.nivelPrevio}. Tono: ${input.perfil.tono}. Tiempo sesión: ${input.perfil.duracionSesion} min.`

  const nodes: TaskNodeConfig[] = [
    {
      id: 'profile',
      agentId: AGENT_IDS.profile,
      name: 'ProfileAgent',
      taskDescription: `${ctxBase}\nPerfil JSON: ${JSON.stringify(input.perfil)}\nProduce la configuración de adaptación completa. Responde SOLO con JSON.`,
      deps: [],
      timeout: 30_000,
      maxRetries: 2,
      priority: 10,
    },
    {
      id: 'intent',
      agentId: AGENT_IDS.intent,
      name: 'IntentAgent',
      taskDescription: `${ctxBase}\nMeta del alumno: "${input.meta}"\nExtrae tema, nivel detectado, topic_slug, tono y confianza. Responde SOLO con JSON.`,
      deps: ['profile'],
      timeout: 60_000,
      maxRetries: 2,
      priority: 9,
    },
    {
      id: 'structure',
      agentId: AGENT_IDS.structure,
      name: 'StructureAgent',
      taskDescription: `${ctxBase}\nMeta: "${input.meta}"\nDiseña el programa completo con ${input.perfil.nodosRecomendados} nodos. Secuencia obligatoria: bienvenida → concepto → código/diagrama → ejercicio → quiz → reto → milestone → evaluación.\nIMPORTANTE: Responde SOLO con JSON válido. El JSON debe tener la estructura {"tema":"string","nodos":[{"id":"n1","titulo":"string","concepto":"string","tipoPedagogico":"concept|exercise|quiz|challenge|milestone|evaluation","tipoVisual":"text_card|code_block|svg_diagram|gif_guide|infographic","xpRecompensa":20}]}`,
      deps: ['intent'],
      timeout: 120_000,
      maxRetries: 2,
      priority: 8,
    },
  ]

  // Gamificación y evaluación NO van aquí — corren en buildFullDAG (Fase 2)
  // junto a los content agents, para que el orden sea correcto en la UI.
  return new TaskGraph(nodes)
}

/**
 * Construye los nodos Tier 1 para cada nodo del currículo.
 * Se llama después de que StructureAgent completa.
 */
export function buildContentNodes(
  nodos: NodoLesson[],
  ctxBase: string,
): TaskNodeConfig[] {
  const tierOneNodes: TaskNodeConfig[] = []

  for (const nodo of nodos) {
    const ctx = `${ctxBase}\nNodo: "${nodo.titulo}". Concepto: "${nodo.concepto}". Nivel: ${nodo.nivel}. Rango edad: ${nodo.rangoEdad}.`

    // Agente de contenido pedagógico según tipo
    const contentAgentMap: Record<string, string> = {
      concept:    AGENT_IDS.explanation,
      exercise:   AGENT_IDS.exercise,
      quiz:       AGENT_IDS.quiz,
      challenge:  AGENT_IDS.challenge,
      milestone:  AGENT_IDS.explanation,
      evaluation: AGENT_IDS.evaluation,
    }

    const contentAgentId = contentAgentMap[nodo.tipoPedagogico] ?? AGENT_IDS.explanation

    tierOneNodes.push({
      id: `content-${nodo.id}`,
      agentId: contentAgentId,
      name: `${contentAgentId.split('-')[1]}:${nodo.id}`,
      taskDescription: `${ctx}\nTipo pedagógico: ${nodo.tipoPedagogico}. Genera el contenido apropiado en JSON.`,
      deps: ['structure'],
      timeout: 30_000,
      maxRetries: 2,
      priority: 5,
    })

    // Agente visual si el tipo_visual no es text_card
    if (nodo.tipoVisual !== 'text_card') {
      const visualAgentMap: Record<string, string> = {
        code_block:    AGENT_IDS.code,
        svg_diagram:   AGENT_IDS.svg,
        gif_guide:     AGENT_IDS.gif,
        infographic:   AGENT_IDS.infographic,
        image_ai:      AGENT_IDS.image,
      }

      const visualAgentId = visualAgentMap[nodo.tipoVisual]
      if (visualAgentId) {
        tierOneNodes.push({
          id: `visual-${nodo.id}`,
          agentId: visualAgentId,
          name: `visual:${nodo.id}`,
          taskDescription: `${ctx}\nTipo visual: ${nodo.tipoVisual}. Genera el asset visual en JSON.`,
          deps: ['structure'],
          timeout: nodo.tipoVisual === 'svg_diagram' ? 45_000 : 25_000,
          maxRetries: 2,
          priority: 4,
        })
      }
    }
  }

  return tierOneNodes
}

/** Construye el TaskGraph completo con nodos de contenido ya conocidos */
export function buildFullDAG(input: HiveLearnDAGInput, nodos: NodoLesson[]): TaskGraph {
  const ctxBase = `Alumno: ${input.alumnoId}. Rango edad: ${input.perfil.rangoEdad}. Nivel: ${input.perfil.nivelPrevio}. Tono: ${input.perfil.tono}.`
  const contentNodes = buildContentNodes(nodos, ctxBase)
  const contentIds = contentNodes.map(n => n.id)

  const tier0: TaskNodeConfig[] = [
    {
      id: 'profile',
      agentId: AGENT_IDS.profile,
      name: 'ProfileAgent',
      taskDescription: `Perfil JSON: ${JSON.stringify(input.perfil)}. Produce la configuración de adaptación. Responde SOLO con JSON.`,
      deps: [],
      timeout: 30_000,
      maxRetries: 2,
      priority: 10,
    },
    {
      id: 'intent',
      agentId: AGENT_IDS.intent,
      name: 'IntentAgent',
      taskDescription: `${ctxBase} Meta: "${input.meta}". Extrae tema, nivel, slug, tono y confianza. Responde SOLO con JSON.`,
      deps: ['profile'],
      timeout: 60_000,
      maxRetries: 2,
      priority: 9,
    },
    {
      id: 'structure',
      agentId: AGENT_IDS.structure,
      name: 'StructureAgent',
      taskDescription: `${ctxBase} Meta: "${input.meta}". Diseña el programa con ${nodos.length} nodos. Responde SOLO con JSON válido con estructura {"tema":"string","nodos":[...]}`,
      deps: ['intent'],
      timeout: 120_000,
      maxRetries: 2,
      priority: 8,
    },
  ]

  const tier2: TaskNodeConfig[] = [
    {
      id: 'gamification',
      agentId: AGENT_IDS.gamification,
      name: 'GamificationAgent',
      taskDescription: `${ctxBase} Rango edad: ${input.perfil.rangoEdad}. Genera XP, logros y celebración.`,
      deps: contentIds.length > 0 ? contentIds : ['structure'],
      timeout: 30_000,
      maxRetries: 1,
      priority: 3,
    },
    {
      id: 'evaluation',
      agentId: AGENT_IDS.evaluation,
      name: 'EvaluationAgent',
      taskDescription: `${ctxBase} Meta: "${input.meta}". 5 preguntas evaluación final (3 opción múltiple + 2 respuesta corta).`,
      deps: contentIds.length > 0 ? contentIds : ['structure'],
      timeout: 45_000,
      maxRetries: 2,
      priority: 3,
    },
  ]

  return new TaskGraph([...tier0, ...contentNodes, ...tier2])
}
