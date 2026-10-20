/**
 * Capa procedural de "vida" de BIA: parpadeo, respiración y balanceo que no
 * entran en bucle.
 *
 * Funciones puras sobre el tiempo y un pequeño estado mutable, sin three ni
 * React, para poder probarlas aparte. Los gestos periódicos (un seno con un solo
 * periodo) se leen como mecanismo; aquí se suman varias frecuencias sin relación
 * entre sí y los parpadeos llegan a intervalos aleatorios.
 */

/** Ruido suave en [-1, 1]: suma de senos con razones irracionales. */
export function ruido(t: number, semilla = 0): number {
  const s = semilla * 12.9898;
  return (
    Math.sin(t * 0.73 + s) * 0.5 +
    Math.sin(t * 1.31 + s * 1.7) * 0.3 +
    Math.sin(t * 2.17 + s * 2.3) * 0.2
  );
}

/** Respiración: se inhala más rápido de lo que se exhala (≈ 40/60). */
export function respiracion(t: number, periodo = 4.2): number {
  const fase = (t % periodo) / periodo;
  const subida = 0.4;
  if (fase < subida) {
    const x = fase / subida;
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
  }
  const x = (fase - subida) / (1 - subida);
  return 0.5 + 0.5 * Math.cos(Math.PI * x);
}

export interface EstadoParpadeo {
  /** Instante (s) del próximo parpadeo. */
  siguiente: number;
  /** Instante (s) en que empezó el parpadeo en curso; -1 si no hay. */
  inicio: number;
  /** Parpadeos que faltan en la ráfaga actual (doble parpadeo ocasional). */
  pendientes: number;
}

export function crearParpadeo(ahora: number): EstadoParpadeo {
  return { siguiente: ahora + 2 + Math.random() * 3, inicio: -1, pendientes: 0 };
}

const CIERRE_S = 0.07;
const APERTURA_S = 0.16;

/**
 * Cierre en [0, 1] para el instante `t`. El párpado cae rápido y sube lento; de
 * vez en cuando el parpadeo se repite una vez.
 */
export function pasoParpadeo(e: EstadoParpadeo, t: number): number {
  if (e.inicio < 0 && t >= e.siguiente) {
    e.inicio = t;
    e.pendientes = Math.random() < 0.18 ? 1 : 0;
  }
  if (e.inicio < 0) return 0;

  const dt = t - e.inicio;
  if (dt < CIERRE_S) return dt / CIERRE_S;
  if (dt < CIERRE_S + APERTURA_S) return 1 - (dt - CIERRE_S) / APERTURA_S;

  e.inicio = -1;
  e.siguiente = e.pendientes > 0 ? t + 0.12 : t + 2.2 + Math.random() * 4.5;
  e.pendientes = 0;
  return 0;
}
