import { useEffect, useState } from 'react'
import { useLessonStore } from './store/lessonStore'
import { ProviderSelectScreen } from './screens/ProviderSelectScreen'
import { ProfileScreen }   from './screens/ProfileScreen'
import { GoalScreen }      from './screens/GoalScreen'
import { LoadingScreen }   from './screens/LoadingScreen'
import { CanvasScreen }    from './screens/CanvasScreen'
import { EvaluationScreen} from './screens/EvaluationScreen'
import { ResultScreen }    from './screens/ResultScreen'

/**
 * LessonCanvas — punto de entrada de la ruta /hivelearn.
 * Layout full-screen sin sidebar ni navbar del dashboard.
 */
export function LessonCanvas() {
  const screen = useLessonStore(s => s.screen)
  const reset = useLessonStore(s => s.reset)
  const isGenerating = useLessonStore(s => s.isGenerating)
  const program = useLessonStore(s => s.program)
  const setSelectedProvider = useLessonStore(s => s.setSelectedProvider)
  const setSelectedModel = useLessonStore(s => s.setSelectedModel)
  const setScreen = useLessonStore(s => s.setScreen)

  const [configChecked, setConfigChecked] = useState(false)

  // Verificar si ya hay provider/model configurado al entrar
  useEffect(() => {
    if (configChecked) return
    ;(async () => {
      try {
        const res = await fetch('/api/hivelearn/config')
        const data = await res.json()
        if (data.configured && data.providerId && data.modelId) {
          // Ya está configurado, usar directamente
          setSelectedProvider(data.providerId)
          setSelectedModel(data.modelId)
          setScreen('profile')
        }
      } catch {
        // Si falla, mostrar selector
      }
      setConfigChecked(true)
    })()
  }, [configChecked, setSelectedProvider, setSelectedModel, setScreen])

  const handleExit = () => {
    if (isGenerating) {
      window.location.href = '/'
    } else if (program) {
      // Hay progreso guardado, confirmar
      if (window.confirm('¿Salir sin guardar los cambios? Tu progreso se mantendrá.')) {
        window.location.href = '/'
      }
    } else {
      reset()
      window.location.href = '/'
    }
  }

  // Mostrar loading mientras verifica la config
  if (!configChecked) {
    return (
      <div className="flex-1 flex flex-col min-h-0 -m-4 bg-gray-950 items-center justify-center flex">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-pulse">🐝</div>
          <p className="text-amber-400 font-bold">Cargando HiveLearn...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 -m-4 bg-gray-950 overflow-hidden relative">

      {screen === 'provider-select' && <ProviderSelectScreen />}
      {screen === 'profile'    && <ProfileScreen />}
      {screen === 'goal'       && <GoalScreen />}
      {screen === 'loading'    && <LoadingScreen />}
      {screen === 'canvas'     && <CanvasScreen />}
      {screen === 'evaluation' && <EvaluationScreen />}
      {screen === 'result'     && <ResultScreen />}
    </div>
  )
}
