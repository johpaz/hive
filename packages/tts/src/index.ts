/**
 * @johpaz/hive-tts
 *
 * Paquete standalone opcional para síntesis de voz offline en Hive.
 * Fallback local cuando no hay internet o no hay providers configurados.
 * Compatible con packages/hivelearn para programas educativos narrados.
 *
 * Iniciar servidor:
 *   bun run packages/tts/src/server.ts
 *
 * Uso desde hivelearn:
 *   import { isTTSAvailable, synthesize } from "@johpaz/hive-tts/client"
 */

export * from "./client.ts"
export { detectPlatform } from "./detect.ts"
