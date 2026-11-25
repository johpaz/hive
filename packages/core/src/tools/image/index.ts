/**
 * Image tools — generación de imágenes y lectura de las imágenes de un documento, con el modelo elegido en Providers → Imagen.
 */
import type { Tool } from "../types";
import { imageGenerateTool } from "./image-generate";
import { officeLeerImagenesTool } from "./office-leer-imagenes";

export function createTools(): Tool[] {
  return [imageGenerateTool, officeLeerImagenesTool];
}

export { imageGenerateTool } from "./image-generate";
export { officeLeerImagenesTool } from "./office-leer-imagenes";
