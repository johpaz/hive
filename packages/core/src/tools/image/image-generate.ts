/**
 * image_generate — crea una imagen a partir de una descripción.
 *
 * Usa el modelo elegido en Providers → Imagen. La imagen se guarda como
 * artifact y se devuelve como `artifact_ref`: el agent loop la detecta y la
 * entrega al chat web o al canal (Telegram, etc.) junto con la respuesta, sin
 * pasar los bytes por el contexto del modelo.
 *
 * @category image
 * @seedId image_generate
 * @spanish crear imagen, generar imagen, dibujar, ilustración, logo, foto, póster
 */
import type { Tool } from "../types";
import { getWorkspace } from "../filesystem/workspace-guard";
import { createArtifact } from "../../artifacts/store";
import {
  ASPECT_RATIOS, ImageGenerationError, ImageModelNotConfiguredError, generateImage, type AspectRatio,
} from "../../multimodal/image-generation";

export const imageGenerateTool: Tool = {
  name: "image_generate",
  // La generación tarda segundos, pero NVIDIA puede encolar: margen sobre el timeout interno de 120 s.
  timeoutMs: 150_000,
  description:
    "Create a NEW image from a text description (illustration, logo, photo-style picture, poster, concept art). " +
    "The finished image is delivered to the user automatically in the chat or channel — do NOT paste a link or base64. " +
    "Write the prompt in English or Spanish with subject, style, lighting and composition. It cannot edit or modify an existing image. " +
    "Spanish: crear imagen, generar imagen, dibujar, hazme una imagen, ilustración, logo, póster, foto",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed description of the image to create." },
      aspect_ratio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "square (default, 1:1), landscape (16:9), portrait (9:16), 4:3 or 3:4.",
      },
    },
    required: ["prompt"],
  },
  execute: async (params, config) => {
    const userId = String(config?.configurable?.user_id ?? "");
    const prompt = typeof params.prompt === "string" ? params.prompt : "";
    const aspect = typeof params.aspect_ratio === "string" && (ASPECT_RATIOS as readonly string[]).includes(params.aspect_ratio)
      ? (params.aspect_ratio as AspectRatio)
      : "square";
    try {
      const img = await generateImage({ prompt, aspectRatio: aspect });
      const artifact = await createArtifact({
        bytes: img.bytes,
        mimeType: img.mimeType,
        kind: "generated_image",
        userId,
        runId: config?.configurable?.run_id ?? null,
        taskId: config?.configurable?.task_id ?? null,
        // Es contenido que el usuario pidió y verá en su historial: no caduca como la basura transitoria.
        expiresAt: null,
        // Carpeta visible del usuario (workspace o ~/Hive), no la oculta de la base de datos.
        visible: { workspace: getWorkspace(config), folder: "imagenes", label: prompt },
      });
      return [
        {
          type: "artifact_ref",
          artifact_id: artifact.id,
          mime_type: artifact.mime_type,
          size: artifact.size,
          sha256: artifact.sha256,
          expires_at: artifact.expires_at,
        },
        {
          type: "text",
          text:
            `Imagen creada con ${img.modelId} (${aspect}). Ya se muestra al usuario junto a tu respuesta y quedó guardada en su equipo: ${artifact.path}. ` +
            "Si te preguntan dónde está, dales esa ruta. No incluyas enlaces ni base64. Cierra con una frase breve sobre lo que creaste y ofrece ajustes (otro estilo, formato u otra idea).",
        },
      ];
    } catch (err) {
      if (err instanceof ImageModelNotConfiguredError) {
        return {
          ok: false,
          error: err.message,
          needs_configuration: true,
          hint: "Dile al usuario que elija el modelo en Providers → Imagen → «Modelo generador de imágenes».",
        };
      }
      if (err instanceof ImageGenerationError) return { ok: false, error: err.message, retryable: err.retryable };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
