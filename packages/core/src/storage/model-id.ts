/**
 * Claves de la colección `models`.
 *
 * La colección se indexa sólo por el id del modelo, así que dos providers que
 * sirvan el mismo modelo colisionan y uno pisa al otro (pasó de verdad con
 * `z-ai/glm-5.2`, presente a la vez en NVIDIA NIM y en OpenRouter).
 *
 * Regla: el id conserva el nombre que le da el propietario del modelo, y los
 * servicios revendedores lo prefijan con su propio id de provider.
 *
 *   nvidia     + z-ai/glm-5.2   → nvidia/z-ai/glm-5.2
 *   openrouter + z-ai/glm-5.2   → openrouter/z-ai/glm-5.2
 *   anthropic  + claude-opus-5  → claude-opus-5
 *
 * El prefijo no llega al cable: `OpenAICompatBase.call()` quita
 * `^<providerName>/` antes de armar el request, así que el provider recibe el
 * nombre del propietario tal cual. Por eso todos los revendedores de esta lista
 * deben ser OpenAI-compatibles.
 */

const RESELLER_PROVIDERS = new Set(["nvidia", "openrouter", "opencode-go", "groq", "modelscope"])

/**
 * Id de fila en `models` para el modelo `wireId` servido por `providerId`.
 *
 * `wireId` es siempre el nombre del cable, nunca una clave ya prefijada. No hay
 * atajo de idempotencia a propósito: "ya lleva el prefijo" es indistinguible de
 * "el namespace del propietario coincide con el id del provider". NVIDIA sirve
 * `nvidia/nemotron-3-super-120b-a12b` y Groq sirve `groq/compound`, así que
 * saltarse el prefijo por un `startsWith` recortaba de más al volver al cable y
 * mandaba `nemotron-…` / `compound`.
 */
export function catalogModelKey(providerId: string, wireId: string): string {
  return RESELLER_PROVIDERS.has(providerId) ? `${providerId}/${wireId}` : wireId
}

/**
 * Inversa de `catalogModelKey`: el nombre que el provider espera en el cable.
 *
 * Los adapters OpenAI-compatibles ya hacen este strip solos al armar el request,
 * así que esto es para los caminos que mandan el modelo a mano — por ejemplo la
 * verificación de API key en `gateway/routes/setup.ts`, que arma su propio fetch.
 */
export function wireModelId(providerId: string, key: string): string {
  const prefix = `${providerId}/`
  if (!RESELLER_PROVIDERS.has(providerId) || !key.startsWith(prefix)) return key
  return key.slice(prefix.length)
}

/** True cuando el provider revende modelos de terceros y por eso prefija sus ids. */
export function isResellerProvider(providerId: string): boolean {
  return RESELLER_PROVIDERS.has(providerId)
}
