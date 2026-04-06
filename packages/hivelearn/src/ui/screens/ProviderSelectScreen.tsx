import { useState, useEffect } from 'react'
import { useLessonStore } from '../store/lessonStore'

interface Provider {
  id: string
  name: string
  enabled: boolean
  active: boolean
}

interface Model {
  id: string
  name: string
  provider_id: string
  enabled: boolean
  active: boolean
  context_window?: number
}

export function ProviderSelectScreen() {
  const { selectedProviderId, selectedModelId, setSelectedProvider, setSelectedModel, setScreen } = useLessonStore()
  
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch providers and models
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        
        // Fetch providers
        const providersRes = await fetch('/api/providers')
        const providersData = await providersRes.json()
        const activeProviders = (providersData.providers || []).filter(
          (p: Provider) => p.enabled && p.active
        )
        setProviders(activeProviders)

        // Fetch models
        const modelsRes = await fetch('/api/models')
        const modelsData = await modelsRes.json()
        const activeModels = (modelsData.models || []).filter(
          (m: Model) => m.enabled && m.active
        )
        setModels(activeModels)
      } catch (err) {
        setError('Error al cargar proveedores y modelos. Verifica la conexión.')
        console.error('Error fetching providers/models:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Filter models by selected provider
  const availableModels = models.filter(
    m => m.provider_id === selectedProviderId
  )

  const handleContinue = () => {
    if (selectedProviderId && selectedModelId) {
      setScreen('profile')
    }
  }

  const selectedProviderName = providers.find(p => p.id === selectedProviderId)?.name
  const selectedModelName = models.find(m => m.id === selectedModelId)?.name

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="text-center">
          <div className="text-5xl sm:text-6xl mb-3 sm:mb-4 animate-pulse">🐝</div>
          <h2 className="text-xl sm:text-2xl font-bold text-amber-400 mb-2">Cargando...</h2>
          <p className="text-sm sm:text-base text-gray-400">Obteniendo proveedores y modelos disponibles</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-gray-900 rounded-xl sm:rounded-2xl border border-gray-800 p-4 sm:p-6 space-y-4">
          <div className="text-center">
            <div className="text-5xl sm:text-6xl mb-3">⚠️</div>
            <h2 className="text-xl sm:text-2xl font-bold text-red-400 mb-2">Error</h2>
            <p className="text-sm text-gray-400 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg sm:rounded-xl bg-amber-500 px-4 sm:px-6 py-2.5 text-sm font-bold text-black hover:bg-amber-400 transition-all"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (providers.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-gray-900 rounded-xl sm:rounded-2xl border border-gray-800 p-4 sm:p-6 space-y-4">
          <div className="text-center">
            <div className="text-5xl sm:text-6xl mb-3">🔧</div>
            <h2 className="text-xl sm:text-2xl font-bold text-amber-400 mb-2">Sin proveedores</h2>
            <p className="text-sm text-gray-400 mb-4">
              No hay proveedores de IA configurados. Configura al menos uno en Settings &gt; Providers.
            </p>
            <a
              href="/providers"
              className="inline-block rounded-lg sm:rounded-xl bg-amber-500 px-4 sm:px-6 py-2.5 text-sm font-bold text-black hover:bg-amber-400 transition-all"
            >
              Ir a Providers
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md sm:max-w-lg">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="text-5xl sm:text-6xl mb-2 sm:mb-3">🐝</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-amber-400">HiveLearn</h1>
          <p className="text-sm sm:text-base text-gray-400 mt-1">Selecciona tu proveedor y modelo de IA</p>
        </div>

        <div className="bg-gray-900 rounded-xl sm:rounded-2xl border border-gray-800 p-4 sm:p-6 space-y-4 sm:space-y-5">
          <h2 className="text-base sm:text-lg font-bold text-white">Configuración del modelo</h2>

          {/* Provider Selection */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Proveedor de IA</label>
            <div className="grid grid-cols-1 gap-2 max-h-40 sm:max-h-48 overflow-y-auto">
              {providers.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => {
                    setSelectedProvider(provider.id)
                    setSelectedModel(null)
                  }}
                  className={`rounded-lg py-2.5 sm:py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium border transition-all text-left
                    ${selectedProviderId === provider.id
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-amber-500/50'}`}
                >
                  <div className="font-bold">{provider.name}</div>
                  <div className="text-[10px] sm:text-xs text-gray-500 mt-1">ID: {provider.id}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Model Selection */}
          {selectedProviderId && (
            <div>
              <label className="block text-xs text-gray-400 mb-2">Modelo</label>
              {availableModels.length === 0 ? (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs sm:text-sm text-gray-400">
                  No hay modelos disponibles para este proveedor
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 sm:max-h-48 overflow-y-auto">
                  {availableModels.map(model => (
                    <button
                      key={model.id}
                      onClick={() => setSelectedModel(model.id)}
                      className={`rounded-lg py-2.5 sm:py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium border transition-all text-left
                        ${selectedModelId === model.id
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-amber-500/50'}`}
                    >
                      <div className="font-bold">{model.name}</div>
                      {model.context_window && (
                        <div className="text-[10px] sm:text-xs text-gray-500 mt-1">
                          Contexto: {(model.context_window / 1000).toFixed(0)}K tokens
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selection Summary */}
          {selectedProviderId && selectedModelId && (
            <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-2.5 sm:p-3">
              <div className="text-[10px] sm:text-xs text-amber-400 mb-1">Selección actual:</div>
              <div className="text-xs sm:text-sm text-white">
                <span className="font-bold">{selectedProviderName}</span> → <span className="font-bold">{selectedModelName}</span>
              </div>
            </div>
          )}

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            disabled={!selectedProviderId || !selectedModelId}
            className="w-full rounded-lg sm:rounded-xl bg-amber-500 py-2.5 sm:py-3 text-xs sm:text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}
