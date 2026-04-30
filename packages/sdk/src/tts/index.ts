/**
 * Hive SDK - TTS Module
 *
 * Exposes offline TTS functionality via @johpaz/hive-tts.
 *
 * @example
 * import { TTSService, synthesize } from "@johpaz/hive-sdk/tts";
 *
 * // Synthesize speech
 * const audio = await synthesize("Hola mundo", "es-ES");
 */

export {
  TTSService,
  synthesize,
  synthesizeToFile,
  listVoices,
  downloadVoice,
  isModelInstalled,
} from "@johpaz/hive-tts";

export type {
  TTSConfig,
  VoiceInfo,
  SynthesisResult,
} from "@johpaz/hive-tts";
