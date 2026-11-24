/**
 * Image tools — generación de imágenes con el modelo elegido en Providers → Imagen.
 */
import type { Tool } from "../types";
import { imageGenerateTool } from "./image-generate";

export function createTools(): Tool[] {
  return [imageGenerateTool];
}

export { imageGenerateTool } from "./image-generate";
