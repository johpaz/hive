/** Provider Ollama para HiveLearn — apunta a localhost:11434 con Gemma 4 E2B */

const OLLAMA_URL = process.env.HIVELEARN_OLLAMA_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.HIVELEARN_MODEL ?? 'gemma4:2b'

export const HIVELEARN_PROVIDER_ID = 'hl-ollama'
export const HIVELEARN_MODEL_ID = 'hl-gemma4-2b'

export const ollamaProviderConfig = {
  id: HIVELEARN_PROVIDER_ID,
  name: 'Ollama Local (HiveLearn)',
  baseUrl: OLLAMA_URL,
  category: 'llm' as const,
  enabled: 1,
  active: 0,
}

export const gemma4ModelConfig = {
  id: HIVELEARN_MODEL_ID,
  providerId: HIVELEARN_PROVIDER_ID,
  name: OLLAMA_MODEL,
  modelType: 'llm' as const,
  contextWindow: 8192,
  enabled: 1,
  active: 0,
}

/** Verifica que Ollama esté disponible en la URL configurada */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    const data = await res.json() as { models?: { name: string }[] }
    const models = data.models ?? []
    const modelName = OLLAMA_MODEL.split(':')[0]
    return models.some(m => m.name.startsWith(modelName))
  } catch {
    return false
  }
}

/** Inserta el provider y modelo Ollama en SQLite si no existen */
export function upsertOllamaProvider(db: import('bun:sqlite').Database): void {
  db.run(`
    INSERT OR IGNORE INTO providers (id, name, base_url, category, enabled, active)
    VALUES (?, ?, ?, 'llm', 1, 0)
  `, [HIVELEARN_PROVIDER_ID, ollamaProviderConfig.name, OLLAMA_URL])

  db.run(`
    INSERT OR IGNORE INTO models (id, provider_id, name, model_type, context_window, enabled, active)
    VALUES (?, ?, ?, 'llm', 8192, 1, 0)
  `, [HIVELEARN_MODEL_ID, HIVELEARN_PROVIDER_ID, OLLAMA_MODEL])
}
