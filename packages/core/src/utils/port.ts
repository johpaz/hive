/**
 * Resolución de puertos desde el entorno.
 *
 * Bun 1.4 endureció `Bun.serve`: un puerto fuera de `[0, 65535]` —o `NaN`, que
 * es lo que devuelve `parseInt("no-es-un-numero")`— ahora lanza `RangeError` en
 * vez de recortar el valor. Un `HIVE_PORT` mal escrito dejó de degradar y pasó a
 * tumbar el arranque con una excepción sin capturar:
 *
 *     RangeError: The value of "options.port" is out of range.
 *                 It must be an integer. Received NaN
 *
 * Este helper vuelve a la degradación explícita: avisa y sigue con el puerto por
 * defecto, que para una variable de entorno mal tipeada es el comportamiento
 * útil. El `0` se deja pasar a propósito: `Bun.serve` lo interpreta como "asigna
 * un puerto libre" y hay código que se apoya en eso.
 *
 * Avisa con `console.warn` y no con el logger del proyecto a propósito: esto lo
 * usa `config/loader.ts`, y el logger importa `config/loader.ts` para saber
 * dónde escribir. Importarlo acá cierra el ciclo y rompe con "Cannot access
 * 'logger' before initialization". Además, cuando se resuelve un puerto el
 * logger todavía no está configurado.
 */

export function resolvePort(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback

  const n = typeof raw === "number" ? raw : Number(String(raw).trim())
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    console.warn(`[config] Puerto inválido ${JSON.stringify(raw)}; se usa ${fallback}`)
    return fallback
  }
  return n
}
