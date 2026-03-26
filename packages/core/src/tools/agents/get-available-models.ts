/**
 * Get Available Models Tool
 *
 * Permite a los agentes consultar providers y modelos activos en la BD
 * para seleccionar el modelo óptimo al crear nuevos agentes.
 *
 * @category agents
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";

export const getAvailableModelsTool: Tool = {
  name: "get_available_models",
  description: "Obtener lista de providers y modelos activos de la base de datos. Sinónimos: ver modelos, listar providers, modelos disponibles, consultar modelos, provider activo, qué modelos tengo, modelos para código, modelos para chat",
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
    const db = getDb();
    const { providerId, modelType, capabilities } = params as {
      providerId?: string;
      modelType?: string;
      capabilities?: string;
    };

    try {
      // Construir query con filtros opcionales
      let query = `
        SELECT 
          p.id as provider_id,
          p.name as provider_name,
          p.category as provider_category,
          m.id as model_id,
          m.name as model_name,
          m.model_type,
          m.context_window,
          m.capabilities
        FROM models m
        INNER JOIN providers p ON m.provider_id = p.id
        WHERE m.enabled = 1 AND m.active = 1 AND p.enabled = 1 AND p.active = 1
      `;

      const whereClauses: string[] = [];
      const queryParams: string[] = [];

      if (providerId) {
        whereClauses.push("p.id = ?");
        queryParams.push(providerId as string);
      }

      if (modelType) {
        whereClauses.push("m.model_type = ?");
        queryParams.push(modelType as string);
      }

      if (capabilities) {
        whereClauses.push("m.capabilities LIKE ?");
        queryParams.push(`%${capabilities as string}%`);
      }

      if (whereClauses.length > 0) {
        query += " AND " + whereClauses.join(" AND ");
      }

      query += " ORDER BY p.name, m.name";

      // Ejecutar query
      const rows = db.query<any, string[]>(query).all(...queryParams) as Array<{
        provider_id: string;
        provider_name: string;
        provider_category: string;
        model_id: string;
        model_name: string;
        model_type: string;
        context_window: number | null;
        capabilities: string | null;
      }>;

      // Transformar a formato amigable
      const result = rows.map(row => ({
        providerId: row.provider_id,
        providerName: row.provider_name,
        providerCategory: row.provider_category,
        modelId: row.model_id,
        modelName: row.model_name,
        modelType: row.model_type,
        contextWindow: row.context_window,
        capabilities: row.capabilities ? JSON.parse(row.capabilities) : null,
      }));

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
