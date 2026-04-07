import { useEffect, useState } from 'react'
import { useLessonStore } from './store/lessonStore'
import { ProviderSelectScreen } from './screens/ProviderSelectScreen'
import { SessionsListScreen } from './screens/SessionsListScreen'
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
  const isGenerating = useLessonStore(s => s.isGenerating)
  const program = useLessonStore(s => s.program)
  const setSelectedProvider = useLessonStore(s => s.setSelectedProvider)
  const setSelectedModel = useLessonStore(s => s.setSelectedModel)
  const setScreen = useLessonStore(s => s.setScreen)

  const [configChecked, setConfigChecked] = useState(false)

  // Al entrar siempre ir a la lista de sesiones (excepto si hay generación activa).
  // Cargar provider/model en background para que esté disponible al crear nueva sesión.
  useEffect(() => {
    if (configChecked) return
    ;(async () => {
      try {
        const res = await fetch('/api/hivelearn/config')
        const data = await res.json()
        if (data.configured && data.providerId && data.modelId) {
          setSelectedProvider(data.providerId)
          setSelectedModel(data.modelId)
        }
      } catch {
        // Si falla la config, igual mostramos sessions
      }
      // Siempre ir a sessions salvo que haya una generación SSE activa
      if (!isGenerating) {
        setScreen('sessions')
      }
      setConfigChecked(true)
    })()
  }, [configChecked, setSelectedProvider, setSelectedModel, setScreen, isGenerating])

  const handleExit = () => {
    if (isGenerating) {
      // Mid-generation: solo redirigimos, el proceso SSE sigue en el backend
      if (window.confirm('¿Salir mientras se genera la lección? Podrás verla en la lista cuando termine.')) {
        setScreen('sessions')
      }
    } else {
      // Volver a la lista de sesiones (no al dashboard)
      setScreen('sessions')
    }
  }

  // Mostrar loading mientras verifica la config
  if (!configChecked) {
    return (
      <div className="flex-1 flex flex-col min-h-0 -m-4 bg-gray-950 items-center justify-center flex">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-pulse">🐝</div>
          <p className="text-blue-400 font-bold">Cargando HiveLearn...</p>
        </div>
      </div>
    )
  }

  // Guardia: si la sesión guardada tenía screen='loading' pero no hay programa
  // Y tampoco se está generando activamente → el proceso se interrumpió, volver a sessions
  const safeScreen = (screen === 'loading' && !program && !isGenerating) ? 'sessions' : screen

  return (
    <div className="flex-1 flex flex-col min-h-0 -m-4 bg-gray-950 overflow-hidden relative">

      {safeScreen === 'provider-select' && <ProviderSelectScreen />}
      {safeScreen === 'sessions'    && <SessionsListScreen />}
      {safeScreen === 'profile'    && <ProfileScreen />}
      {safeScreen === 'goal'       && <GoalScreen />}
      {safeScreen === 'loading'    && <LoadingScreen />}
      {safeScreen === 'canvas'     && <CanvasScreen />}
      {safeScreen === 'evaluation' && <EvaluationScreen />}
      {safeScreen === 'result'     && <ResultScreen />}
    </div>
  )
}
