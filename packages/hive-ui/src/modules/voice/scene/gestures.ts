/**
 * Director de gestos de las manos de BIA.
 *
 * Antes las manos se mecían con un vaivén cuya amplitud seguía el volumen: se
 * movían igual al saludar que al explicar algo largo. Aquí cada estado tiene su
 * ademán —hablar, escuchar, pensar, celebrar— y al hablar se alternan variantes
 * cada pocos segundos (las dos manos, una sola, palmas abiertas, contando). Los
 * picos de la voz marcan el énfasis con un golpe corto.
 *
 * Sin three ni React: recibe números y devuelve la pose de cada mano en [0, 1],
 * lista para escribir en los morph targets.
 */

import { ruido } from "./idleLife";
import type { BiaState } from "./BiaPortrait";

/** Pose de una mano. Todos los valores en [0, 1]. */
export interface PoseMano {
  /** Giro de la muñeca sobre sí misma (`mano_*`): el ademán grande. */
  mano: number;
  /** Cierre de los dedos (`dedos_*`). */
  dedos: number;
  /** Separación de los dedos (`abre_*`). */
  abre: number;
  /** Giro del antebrazo, palma hacia delante (`muneca_*`). */
  muneca: number;
}

export interface PoseManos {
  izq: PoseMano;
  der: PoseMano;
}

export interface EntradaGestos {
  /** Segundos desde que arrancó la escena. */
  t: number;
  estado: BiaState;
  /** Nivel suavizado de la voz del modelo, 0–1. */
  voz: number;
  /** Flanco de subida de cualquiera de las dos voces (audioPulse.onset). */
  onset: number;
  /** La colmena está trabajando en una consulta. */
  working: boolean;
}

type Variante = "ambas" | "una" | "abiertas" | "cuenta";
const VARIANTES: readonly Variante[] = ["ambas", "una", "abiertas", "cuenta", "ambas", "una"];

const nueva = (): PoseMano => ({ mano: 0, dedos: 0.05, abre: 0, muneca: 0 });
const lim = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Topes de los morphs de dedos. Un morph target mezcla posiciones en línea
 * recta, no giros: a más de ~⅓ del recorrido los dedos se acortan y se
 * amontonan sobre la palma, y combinados con el giro de `mano` (que se calculó
 * sobre la pose base) la mano se aplasta. Con estos topes se queda en un
 * ademán legible; el gesto grande lo lleva `mano`, que sí es un giro limpio.
 */
const TOPE = { dedos: 0.3, abre: 0.5, muneca: 0.15 } as const;
function topar(o: PoseMano): PoseMano {
  return {
    mano: o.mano,
    dedos: Math.min(o.dedos, TOPE.dedos),
    abre: Math.min(o.abre, TOPE.abre),
    muneca: Math.min(o.muneca, TOPE.muneca),
  };
}

/** Suavizado exponencial independiente de la tasa de fotogramas. */
function acercar(actual: number, objetivo: number, k: number, dt: number): number {
  return actual + (objetivo - actual) * (1 - Math.exp(-k * dt));
}

export class DirectorDeGestos {
  private variante: Variante = "ambas";
  /** Qué mano lleva el ademán cuando solo se usa una: 0 = izq, 1 = der. */
  private lado: 0 | 1 = 1;
  private cambiaEn = 0;
  private estadoPrevio: BiaState | "piensa" = "reposo";
  private pulso = 0;
  private ultimoPulso = -10;
  private readonly pose: PoseManos = { izq: nueva(), der: nueva() };

  step(e: EntradaGestos, dt: number): PoseManos {
    const modo: BiaState | "piensa" = e.working && e.estado !== "habla" ? "piensa" : e.estado;
    if (modo !== this.estadoPrevio || e.t >= this.cambiaEn) {
      this.estadoPrevio = modo;
      this.variante = VARIANTES[Math.floor(Math.random() * VARIANTES.length)]!;
      this.lado = Math.random() < 0.5 ? 0 : 1;
      this.cambiaEn = e.t + 2.2 + Math.random() * 2.6;
    }

    // Énfasis: un golpe corto cuando la voz arranca una sílaba fuerte.
    if (modo === "habla" && e.onset > 0.35 && e.t - this.ultimoPulso > 0.7) {
      this.pulso = 1;
      this.ultimoPulso = e.t;
    }
    this.pulso *= Math.exp(-dt / 0.25);

    const objIzq = topar(this.objetivo(e, modo, 0));
    const objDer = topar(this.objetivo(e, modo, 1));
    for (const [pose, obj] of [
      [this.pose.izq, objIzq],
      [this.pose.der, objDer],
    ] as const) {
      pose.mano = acercar(pose.mano, obj.mano, 5, dt);
      pose.dedos = acercar(pose.dedos, obj.dedos, 6, dt);
      pose.abre = acercar(pose.abre, obj.abre, 5, dt);
      pose.muneca = acercar(pose.muneca, obj.muneca, 4, dt);
    }
    return this.pose;
  }

  /** Lo que debe hacer una mano ahora; `idx` 0 = izq, 1 = der. */
  private objetivo(e: EntradaGestos, modo: BiaState | "piensa", idx: 0 | 1): PoseMano {
    // Vaivén de base en contrafase entre manos; con ruido para no entrar en bucle.
    const onda = Math.sin(e.t * 0.9 + (idx ? Math.PI : 0) + ruido(e.t * 0.3, idx + 7) * 0.8) * 0.5 + 0.5;
    const activa = this.lado === idx;
    const o = nueva();

    switch (modo) {
      case "habla": {
        const amp = 0.35 + e.voz * 1.2;
        const golpe = this.pulso;
        if (this.variante === "ambas") {
          o.mano = lim(onda * amp + 0.25 * golpe);
          o.dedos = 0.12 + 0.25 * golpe;
          o.abre = 0.3 * e.voz;
        } else if (this.variante === "una") {
          if (activa) {
            o.mano = lim(onda * amp * 1.3 + 0.3 * golpe);
            o.dedos = 0.2 + 0.25 * golpe;
            o.muneca = 0.5 * onda;
          } else {
            o.mano = 0.2;
            o.dedos = 0.2;
          }
        } else if (this.variante === "abiertas") {
          o.mano = lim(0.55 + 0.3 * e.voz + 0.2 * golpe);
          o.abre = 0.8;
          o.dedos = 0;
        } else {
          // "cuenta": una mano cierra los dedos como enumerando.
          if (activa) {
            o.mano = lim(0.5 + 0.3 * onda + 0.2 * golpe);
            o.dedos = lim(0.7 + 0.3 * golpe);
            o.muneca = 0.25;
          } else {
            o.mano = 0.2;
            o.dedos = 0.2;
          }
        }
        break;
      }
      case "escucha":
        o.mano = 0.22 * onda;
        o.dedos = 0.1;
        o.abre = 0.1;
        o.muneca = 0.35;
        break;
      case "piensa":
        // Una mano sube y se cierra a medias, como quien se apoya en el mentón.
        if (activa) {
          o.mano = 0.65 + 0.1 * onda;
          o.dedos = 0.45;
          o.muneca = 0.3;
        } else {
          o.mano = 0.1;
          o.dedos = 0.2;
        }
        break;
      case "exito":
        o.mano = 0.8 + 0.2 * onda;
        o.abre = 0.9;
        o.dedos = 0;
        break;
      default:
        o.mano = 0.3 * onda;
        o.dedos = 0.05 + 0.04 * ruido(e.t * 0.4, idx + 11);
        // Dedos algo separados: la malla los trae pegados por la base.
        o.abre = 0.2;
    }
    return o;
  }
}
