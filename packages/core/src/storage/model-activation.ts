import type { ModelDoc, ProviderDoc } from "./collections"
import { col } from "./hive"
import { supportsStt } from "../voice/stt-models"

export function voiceModelActivation(model: ModelDoc, provider?: ProviderDoc) {
  if (model.unlisted || (model.model_type !== "tts" && !supportsStt(model, provider?.base_url))) return
  const active = !!(provider?.active && provider.enabled)
  return { active, enabled: active }
}

export async function reconcileProviderVoiceModels(provider: ProviderDoc): Promise<void> {
  const models = await col<ModelDoc>("models")
  for (const row of await models.findBy("provider_id", provider.id)) {
    const activation = voiceModelActivation(row.doc, provider)
    if (!activation || (row.doc.active === activation.active && row.doc.enabled === activation.enabled)) continue
    await models.put(row.id, { ...row.doc, ...activation }, { expectedVersion: row.version })
  }
}
