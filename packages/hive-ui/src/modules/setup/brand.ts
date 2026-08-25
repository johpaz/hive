/**
 * Textos de marca del asistente de configuración.
 *
 * Está aislado en un archivo propio porque es lo único que cambia entre Hive y
 * sus verticales derivados (hiveCrypto, hiveCode, HiveLearn): al derivar un
 * vertical se edita este archivo y la primera pantalla ya habla del producto
 * correcto, en vez de tener que perseguir cadenas por todo el asistente.
 */

export const SETUP_BRAND = {
  /** Nombre del producto, tal como se muestra al usuario. */
  name: "Hive",
  /** Bajada corta para la cabecera. Va en mayúsculas por CSS. */
  tagline: "Agentes IA local-first",
  /** Etiqueta de la pantalla de bienvenida. */
  eyebrow: "Configuración inicial",
  /** Titular de bienvenida. */
  welcomeTitle: "Bienvenido a Hive",
  /** Párrafo de bienvenida. Dos frases como máximo. */
  welcomeBody:
    "Tu colmena de agentes IA: local-first, multi-canal y open source. " +
    "En los próximos minutos configuras tu agente personal y queda listo para trabajar.",
  /** Titular de la pantalla final, ya con todo configurado. */
  successTitle: "¡Todo listo!",
} as const;
