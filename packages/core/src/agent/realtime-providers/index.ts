/**
 * Registro de proveedores de voz en tiempo real.
 *
 * Hoy sólo Gemini Live. La interfaz existe desacoplada para que añadir OpenAI
 * Realtime o Nova Sonic no obligue a tocar el gateway ni el cliente: cambia el
 * adaptador, no el transporte.
 */

import { GeminiLiveProvider } from "./gemini-live";
import type { RealtimeProvider } from "./interface";

export * from "./interface";
export { DEFAULT_GEMINI_LIVE_MODEL } from "./gemini-live";

const providers = new Map<string, RealtimeProvider>([["gemini", new GeminiLiveProvider()]]);

export function getRealtimeProvider(providerId: string): RealtimeProvider {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error(
      `El proveedor "${providerId}" no soporta voz en tiempo real. Disponibles: ${[...providers.keys()].join(", ")}`,
    );
  }
  return provider;
}

export function isRealtimeProvider(providerId: string): boolean {
  return providers.has(providerId);
}
