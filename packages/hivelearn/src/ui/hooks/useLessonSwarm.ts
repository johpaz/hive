import { useCallback } from 'react'
import { useLessonStore } from '../store/lessonStore'
import type { StudentProfile } from '../../types'
import { fetchWithAuth } from '../lib/fetchWithAuth'

/**
 * Hook que conecta HiveLearnSwarm con el store via SSE streaming.
 * El progreso por agente llega en tiempo real desde el agent-bus del backend.
 */
export function useLessonSwarm() {
  const {
    setProgram, setSwarmProgress, setScreen,
    selectedProviderId, selectedModelId,
    setSessionId, setCurriculoId, setIsGenerating,
    setAgentStatus,
  } = useLessonStore()

  const generateLesson = useCallback(async (profile: StudentProfile, goal: string) => {
    if (!selectedProviderId || !selectedModelId) {
      console.error('HiveLearn: providerId y modelId son requeridos')
      return
    }

    setScreen('loading')
    setIsGenerating(true)
    setSwarmProgress({
      etapa: 'tier0',
      agenteActivo: 'ProfileAgent',
      porcentaje: 2,
      mensaje: 'Iniciando el enjambre de agentes...',
    })

    try {
      const response = await fetchWithAuth('/api/hivelearn/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perfil: profile,
          meta: goal,
          providerId: selectedProviderId,
          modelId: selectedModelId,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`Error del servidor: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Split on double newline (SSE event separator)
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const eventText of parts) {
          if (!eventText.trim()) continue

          let eventType = 'message'
          let dataStr = ''

          for (const line of eventText.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim()
          }

          if (!dataStr) continue

          let data: any
          try { data = JSON.parse(dataStr) } catch { continue }

          switch (eventType) {
            case 'progress':
              setSwarmProgress(data)
              break
            case 'agent_started':
              setAgentStatus(data.agentId, 'running')
              break
            case 'agent_completed':
              setAgentStatus(data.agentId, 'completed')
              break
            case 'agent_failed':
              setAgentStatus(data.agentId, 'failed')
              break
            case 'complete':
              setProgram(data)
              setSessionId(data.sessionId)
              setCurriculoId(data.curriculoId)
              setIsGenerating(false)
              setScreen('canvas')
              break
            case 'error':
              throw new Error(data.message ?? 'Error desconocido del swarm')
          }
        }
      }
    } catch (err) {
      setIsGenerating(false)
      setSwarmProgress({
        etapa: 'error',
        agenteActivo: 'Sistema',
        porcentaje: 0,
        mensaje: `Error: ${(err as Error).message}`,
      })
    }
  }, [
    setProgram, setSwarmProgress, setScreen,
    selectedProviderId, selectedModelId,
    setSessionId, setCurriculoId, setIsGenerating,
    setAgentStatus,
  ])

  return { generateLesson }
}
