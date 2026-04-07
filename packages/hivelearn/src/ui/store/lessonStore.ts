import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StudentProfile, LessonProgram, NodoLesson, SwarmProgress, FeedbackOutput, AgentStatus, CoordinatorState } from '../../types'

export type Screen = 'provider-select' | 'sessions' | 'profile' | 'goal' | 'loading' | 'canvas' | 'evaluation' | 'result'

export interface XpFloat {
  nodeId: string
  xp: number
  key: number
}

interface LessonState {
  // Navegación
  screen: Screen

  // Provider y modelo seleccionados
  selectedProviderId: string | null
  selectedModelId: string | null

  // Sesión
  sessionId: string | null
  curriculoId: number | null
  isGenerating: boolean
  sessionRestored: boolean

  // Datos del alumno
  perfil: StudentProfile | null
  meta: string

  // Programa generado
  program: LessonProgram | null

  // Progreso del enjambre
  swarmProgress: SwarmProgress | null
  agentStatuses: Record<string, AgentStatus>

  // Estado del coordinador
  coordinatorState: CoordinatorState

  // Estado de la sesión
  nodoActualId: string | null
  selectedNodeId: string | null   // nodo seleccionado en el grafo (panel lateral)
  xpTotal: number
  logrosDesbloqueados: string[]
  nodosCompletados: string[]
  tiempoInicioSesion: number | null

  // Gamificación activa
  vidas: number
  racha: number
  xpFloat: XpFloat | null

  // Evaluación
  respuestasEvaluacion: Record<number, string | number>
  puntajeEvaluacion: number | null

  // Feedback del nodo actual
  lastFeedback: FeedbackOutput | null

  // Acciones base
  setScreen: (screen: Screen) => void
  setSelectedProvider: (providerId: string) => void
  setSelectedModel: (modelId: string | null) => void
  setPerfil: (perfil: StudentProfile) => void
  setMeta: (meta: string) => void
  setProgram: (program: LessonProgram) => void
  setSwarmProgress: (progress: SwarmProgress) => void
  setAgentStatus: (agentId: string, status: AgentStatus) => void
  setCoordinatorStatus: (status: CoordinatorState['status'], currentWorker?: string | null) => void
  setSessionId: (sessionId: string) => void
  setCurriculoId: (curriculoId: number) => void
  setIsGenerating: (isGenerating: boolean) => void
  completarNodo: (nodoId: string, xpGanado: number) => void
  desbloquearLogro: (logroId: string) => void
  setNodoActual: (nodoId: string) => void
  setLastFeedback: (feedback: FeedbackOutput | null) => void
  responderEvaluacion: (idx: number, respuesta: string | number) => void
  setPuntajeEvaluacion: (puntaje: number) => void
  restoreSession: (program: LessonProgram, sessionData: any) => void
  reset: () => void

  // Acciones de panel lateral
  selectNode: (nodeId: string) => void
  deselectNode: () => void

  // Acciones de gamificación
  perderVida: () => void
  incrementarRacha: () => void
  resetRacha: () => void
  showXpFloat: (nodeId: string, xp: number) => void
}

const initialState = {
  screen: 'sessions' as Screen,
  perfil: null,
  meta: '',
  program: null,
  swarmProgress: null,
  agentStatuses: {},
  coordinatorState: {
    status: 'idle' as CoordinatorState['status'],
    currentWorker: null,
    activeWorkers: [],
    totalWorkers: 15,
  },
  selectedProviderId: null,
  selectedModelId: null,
  sessionId: null,
  curriculoId: null,
  isGenerating: false,
  sessionRestored: false,
  nodoActualId: null,
  selectedNodeId: null,
  xpTotal: 0,
  logrosDesbloqueados: [],
  nodosCompletados: [],
  tiempoInicioSesion: null,
  vidas: 3,
  racha: 0,
  xpFloat: null,
  respuestasEvaluacion: {},
  puntajeEvaluacion: null,
  lastFeedback: null,
}

let xpFloatKey = 0

export const useLessonStore = create<LessonState>()(persist((set, get) => ({
  ...initialState,

  setScreen: (screen) => set({ screen }),
  setSelectedProvider: (selectedProviderId) => set({ selectedProviderId }),
  setSelectedModel: (selectedModelId) => set({ selectedModelId }),
  setPerfil: (perfil) => set({ perfil }),
  setMeta: (meta) => set({ meta }),
  setProgram: (program) => set({
    program,
    tiempoInicioSesion: Date.now(),
    nodoActualId: program.nodos[0]?.id ?? null,
  }),
  setSwarmProgress: (swarmProgress) => set({ swarmProgress }),
  setAgentStatus: (agentId, status) => set((s) => ({
    agentStatuses: { ...s.agentStatuses, [agentId]: status },
    coordinatorState: {
      ...s.coordinatorState,
      activeWorkers: Object.entries({ ...s.agentStatuses, [agentId]: status })
        .filter(([, st]) => st === 'running' || st === 'thinking' || st === 'tool_call')
        .map(([id]) => id),
    },
  })),
  setCoordinatorStatus: (status, currentWorker) => set((s) => ({
    coordinatorState: {
      ...s.coordinatorState,
      status,
      currentWorker: currentWorker ?? s.coordinatorState.currentWorker,
    },
  })),
  setSessionId: (sessionId) => set({ sessionId }),
  setCurriculoId: (curriculoId) => set({ curriculoId }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  completarNodo: (nodoId, xpGanado) => set((s) => {
    const nodos = s.program?.nodos ?? []
    const idx = nodos.findIndex(n => n.id === nodoId)
    const nextId = idx >= 0 && idx < nodos.length - 1 ? nodos[idx + 1].id : null
    return {
      nodosCompletados: [...s.nodosCompletados, nodoId],
      xpTotal: s.xpTotal + xpGanado,
      nodoActualId: nextId ?? s.nodoActualId,
      program: s.program ? {
        ...s.program,
        nodos: s.program.nodos.map((n, i) => {
          if (n.id === nodoId) return { ...n, estado: 'completado' as const }
          if (i === idx + 1) return { ...n, estado: 'disponible' as const }
          return n
        }),
      } : null,
    }
  }),
  desbloquearLogro: (logroId) => set((s) => ({
    logrosDesbloqueados: s.logrosDesbloqueados.includes(logroId)
      ? s.logrosDesbloqueados
      : [...s.logrosDesbloqueados, logroId],
  })),
  setNodoActual: (nodoId) => set({ nodoActualId: nodoId }),
  setLastFeedback: (lastFeedback) => set({ lastFeedback }),
  responderEvaluacion: (idx, respuesta) => set((s) => ({
    respuestasEvaluacion: { ...s.respuestasEvaluacion, [idx]: respuesta },
  })),
  setPuntajeEvaluacion: (puntajeEvaluacion) => set({ puntajeEvaluacion }),
  restoreSession: (program, sessionData) => set({
    program,
    sessionId: sessionData.sessionId,
    xpTotal: sessionData.xpTotal,
    nodosCompletados: sessionData.nodosCompletados || [],
    tiempoInicioSesion: Date.now(),
    nodoActualId: program.nodos[0]?.id ?? null,
    sessionRestored: true,
    screen: 'canvas',
  }),
  reset: () => set((s) => ({
    ...initialState,
    selectedProviderId: s.selectedProviderId,
    selectedModelId:    s.selectedModelId,
  })),

  // Panel lateral
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, lastFeedback: null }),
  deselectNode: () => set({ selectedNodeId: null, lastFeedback: null }),

  // Gamificación
  perderVida: () => set((s) => ({ vidas: Math.max(0, s.vidas - 1) })),
  incrementarRacha: () => set((s) => ({ racha: s.racha + 1 })),
  resetRacha: () => set({ racha: 0 }),
  showXpFloat: (nodeId, xp) => {
    const key = ++xpFloatKey
    set({ xpFloat: { nodeId, xp, key } })
    setTimeout(() => {
      if (get().xpFloat?.key === key) set({ xpFloat: null })
    }, 1400)
  },
}), {
  name: 'hivelearn-session-v1',
  storage: createJSONStorage(() => localStorage),
  // Solo persistir los campos necesarios para restaurar la sesión
  partialize: (state) => ({
    screen:              state.screen,
    program:             state.program,
    sessionId:           state.sessionId,
    curriculoId:         state.curriculoId,
    perfil:              state.perfil,
    meta:                state.meta,
    xpTotal:             state.xpTotal,
    nodosCompletados:    state.nodosCompletados,
    nodoActualId:        state.nodoActualId,
    selectedProviderId:  state.selectedProviderId,
    selectedModelId:     state.selectedModelId,
    vidas:               state.vidas,
    racha:               state.racha,
    logrosDesbloqueados: state.logrosDesbloqueados,
    swarmProgress:       state.swarmProgress,
    agentStatuses:       state.agentStatuses,
  }),
}))
