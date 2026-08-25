/**
 * Carga el lector de hojas de cálculo, o explica por qué no puede.
 *
 * `xlsx` se importa en caliente para no pagarlo en cada arranque, y eso deja el
 * fallo a merced del momento: si la dependencia no llegó a instalarse —su
 * tarball se cayó una vez en mitad de un release— el usuario recibía un
 * "Cannot find module" crudo en medio de una respuesta.
 */
export async function cargarXlsx(): Promise<typeof import("xlsx")> {
  try {
    return await import("xlsx");
  } catch (error) {
    throw new Error(
      "El soporte de hojas de cálculo no está disponible en esta instalación: " +
        `falta la dependencia «xlsx» (${(error as Error).message}). ` +
        "Reinstala las dependencias con `bun install` para recuperarlo.",
    );
  }
}
