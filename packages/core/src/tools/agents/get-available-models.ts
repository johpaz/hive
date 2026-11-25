/**
 * Get Available Models Tool
 *
 * Permite a los agentes consultar providers y modelos activos en la BD
 * para seleccionar el modelo óptimo al crear nuevos agentes.
 *
 * @category agents
 */

import type { Tool } from "../types.ts";
import { col } from "../../storage/hive.ts";
import type { ProviderDoc, ModelDoc } from "../../storage/collections.ts";

export const getAvailableModelsTool: Tool = {
  name: "get_available_models",
  description: "Obtener el catálogo completo de modelos de los providers configurados (con credenciales activas) para elegir el más adecuado según capacidad, contexto o costo — no solo el modelo por defecto del usuario. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat",
  parameters: {
    type: "object",
    properties: {
      providerId: {
        type: "string",
        description: "Opcional: filtrar por provider (openai, ollama, anthropic, gemini, etc.)"
      },
      modelType: {
        type: "string",
        description: "Opcional: filtrar por tipo (llm, stt, tts, vision, embedding)"
      },
      capabilities: {
        type: "string",
        description: "Opcional: filtrar por capacidad (coding, chat, analysis, vision, reasoning)"
      }
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const { providerId, modelType, capabilities } = params as {
      providerId?: string;
      modelType?: string;
      capabilities?: string;
    };

    try {
      const providersCol = await col<ProviderDoc>("providers");
      const providersById = new Map(
        (await providersCol.scan({}))
          .map(e => e.doc)
          .filter(p => p.enabled && p.active)
          .map(p => [p.id, p])
      );

      // Gate on the *provider* being configured (enabled + active, i.e. it has valid
      // credentials) — not on the individual model's own `active` flag. `active` on a
      // ModelDoc only marks the single model onboarding/voice-setup picked as the
      // user's current default; it is not "this model is unusable". Once a provider is
      // configured, every model under it should be visible so the caller can pick the
      // one that actually fits the task (capability, context window, cost), instead of
      // being stuck with whichever model happened to be flagged as the default.
      const modelsCol = await col<ModelDoc>("models");
      let models = (await modelsCol.scan({}))
        .map(e => e.doc)
        .filter(m => m.enabled && providersById.has(m.provider_id));

      if (providerId) models = models.filter(m => m.provider_id === providerId);
      if (modelType) models = models.filter(m => m.model_type === modelType);
      if (capabilities) models = models.filter(m => (m.capabilities ?? "").includes(capabilities));

      // Transformar a formato amigable
      const result = models
        .map(m => {
          const provider = providersById.get(m.provider_id)!;
          return {
            providerId: provider.id,
            providerName: provider.name,
            providerCategory: provider.category,
            modelId: m.id,
            modelName: m.name,
            modelType: m.model_type,
            contextWindow: m.context_window,
            capabilities: m.capabilities ? JSON.parse(m.capabilities) : null,
            isDefault: m.active,
          };
        })
        .sort((a, b) => (Number(b.isDefault) - Number(a.isDefault)) || a.providerName.localeCompare(b.providerName) || a.modelName.localeCompare(b.modelName));

      return {
        ok: true,
        count: result.length,
        models: result,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to get available models: ${(error as Error).message}`,
      };
    }
  },
};
