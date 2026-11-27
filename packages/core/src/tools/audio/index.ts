/**
 * Audio tools — voz sintetizada (podcast, narración) con el TTS local o el de un proveedor.
 */
import type { Tool } from "../types";
import { audioGenerateTool, audioVoicesTool } from "./audio-generate";

export function createTools(): Tool[] {
  return [audioGenerateTool, audioVoicesTool];
}

export { audioGenerateTool, audioVoicesTool } from "./audio-generate";
