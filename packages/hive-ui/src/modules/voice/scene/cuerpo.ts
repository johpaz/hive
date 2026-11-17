/**
 * Animación del cuerpo de BIA con el esqueleto del GLB.
 *
 * Antes el cuerpo era una sola pieza rígida: se mecía el grupo entero y sólo se
 * movían las manos (morph targets). Ahora el GLB trae 14 huesos —columna, pecho,
 * cuello, cabeza, hombros, brazos, antebrazos, alas y cola— y cada estado mueve
 * los suyos: la cabeza se ladea al pensar, asiente con el énfasis de la voz, las
 * alas aletean al celebrar, la cola se mece con retardo y el antebrazo sube con
 * el ademán de la mano.
 *
 * `poseCuerpo` es una función pura (sin three) que devuelve giros en ejes del
 * MODELO —x a la derecha, y arriba, z hacia quien mira—; `CuerpoRig` los traduce
 * al marco local de cada hueso. "L" es el lado +x, igual que `blink_L`.
 */

import { Bone, Euler, Object3D, Quaternion } from "three";
import type { BiaState } from "./BiaPortrait";
import type { PoseManos } from "./gestures";
import { respiracion, ruido } from "./idleLife";

export const HUESOS = [
  "spine", "chest", "neck", "head", "tail_1", "tail_2",
  "shoulder_L", "arm_L", "forearm_L", "wing_L",
  "shoulder_R", "arm_R", "forearm_R", "wing_R",
] as const;
export type Hueso = (typeof HUESOS)[number];
/** Giro (rad) alrededor de x, y, z del modelo. */
export type Giro = [number, number, number];
export type PoseCuerpo = Record<Hueso, Giro>;

export interface EntradaCuerpo {
  t: number;
  estado: BiaState;
  /** Voz del modelo suavizada, 0–1. */
  voz: number;
  /** Micrófono suavizado, 0–1. */
  mic: number;
  /** Flanco de subida de la voz (audioPulse.onset). */
  onset: number;
  /** Pensando / colmena trabajando, suavizado 0–1. */
  piensa: number;
  /** Celebración suavizada 0–1 (estado `exito`). */
  exito: number;
  /** Alarma suavizada 0–1 (estado `alerta`). */
  alerta: number;
  manos: PoseManos;
}

const cero = (): Giro => [0, 0, 0];

export function poseCuerpo(e: EntradaCuerpo): PoseCuerpo {
  const { t, voz, mic, onset, piensa, exito, alerta } = e;
  const p = Object.fromEntries(HUESOS.map((h) => [h, cero()])) as PoseCuerpo;
  const respira = respiracion(t) - 0.5; // -0.5..0.5

  // Columna y pecho: respiración y un vaivén lento. El pecho se echa atrás al
  // inhalar y se adelanta con la voz, como quien empuja el aire al hablar.
  p.spine[0] = ruido(t * 0.5, 10) * 0.012;
  p.spine[2] = ruido(t * 0.4, 11) * 0.014;
  p.chest[0] = -respira * 0.035 + voz * 0.018 - alerta * 0.04;
  p.chest[1] = ruido(t * 0.35, 12) * 0.02;
  p.shoulder_L[2] = respira * 0.03 + exito * 0.05;
  p.shoulder_R[2] = -respira * 0.03 - exito * 0.05;

  // Cabeza: cabeceo al hablar (más con cada golpe de voz), se vuelve hacia quien
  // habla, y al pensar se ladea y mira de lado como quien busca la respuesta.
  const cabeceo =
    ruido(t * 1.3, 4) * 0.03 * (0.4 + voz * 3) +
    ruido(t * 2.7, 5) * 0.01 * voz +
    onset * 0.05 -
    piensa * 0.05 -
    alerta * 0.06 -
    exito * 0.03;
  const giro = mic * 0.1 + piensa * (0.16 + ruido(t * 0.4, 3) * 0.03) + ruido(t * 0.3, 7) * 0.02;
  const ladeo = ruido(t * 0.8, 6) * 0.015 + piensa * 0.07 + exito * ruido(t * 3, 8) * 0.02;
  p.neck[0] = cabeceo * 0.4;
  p.neck[1] = giro * 0.4;
  p.neck[2] = ladeo * 0.4;
  p.head[0] = cabeceo * 0.6;
  p.head[1] = giro * 0.6;
  p.head[2] = ladeo * 0.6;

  // Brazos: el ademán de cada mano arrastra el antebrazo hacia arriba y adelante
  // (los morphs sólo giran la mano; sin esto el gesto sale de la muñeca).
  for (const [s, mano, lado] of [[1, e.manos.izq, "L"], [-1, e.manos.der, "R"]] as const) {
    const brazo = `arm_${lado}` as Hueso;
    const ante = `forearm_${lado}` as Hueso;
    const deriva = ruido(t * 0.55, s > 0 ? 20 : 21) * 0.04;
    p[brazo][2] = s * (mano.mano * 0.22 + exito * 0.5 + deriva);
    p[brazo][1] = -s * (mano.mano * 0.16 + piensa * (s > 0 ? 0.12 : 0));
    p[ante][2] = s * (mano.mano * 0.32 + exito * 0.3);
    p[ante][1] = -s * (mano.abre * 0.1 + piensa * (s > 0 ? 0.35 : 0));
  }

  // Alas: aleteo suave siempre, más ancho trabajando y un aleteo franco al celebrar.
  const aleteo =
    Math.sin(t * 2.1) * (0.035 + piensa * 0.03 + voz * 0.02) +
    Math.sin(t * 9) * exito * 0.22 +
    alerta * 0.18;
  p.wing_L[2] = aleteo;
  p.wing_R[2] = -aleteo;
  p.wing_L[1] = ruido(t * 0.6, 30) * 0.03;
  p.wing_R[1] = -ruido(t * 0.6, 31) * 0.03;

  // Cola: se mece con retardo creciente hacia la punta, como un péndulo.
  const mece = 0.05 + voz * 0.03 + piensa * 0.02;
  p.tail_1[2] = Math.sin(t * 0.9) * mece + ruido(t * 0.3, 40) * 0.02;
  p.tail_1[0] = ruido(t * 0.5, 41) * 0.03;
  p.tail_2[2] = Math.sin(t * 0.9 - 0.9) * mece * 1.7;
  p.tail_2[0] = ruido(t * 0.5 - 0.8, 42) * 0.05;
  return p;
}

interface Reposo {
  hueso: Bone;
  local: Quaternion;
  mundo: Quaternion;
  mundoInv: Quaternion;
}

/**
 * Aplica `PoseCuerpo` a los huesos de un modelo ya clonado con SkeletonUtils.
 *
 * El giro llega en ejes del modelo; el hueso lo necesita en su marco local:
 * q_local = reposo_local · (reposo_mundo⁻¹ · giro · reposo_mundo). Con el padre
 * en reposo da exactamente giro · reposo_mundo, y cuando el padre se mueve el
 * hijo lo hereda por la jerarquía, que es lo que se busca.
 */
export class CuerpoRig {
  private readonly huesos = new Map<Hueso, Reposo>();
  private readonly q = new Quaternion();
  private readonly e = new Euler();

  constructor(raiz: Object3D) {
    // `raiz` aún no cuelga de la escena: el mundo es el del modelo.
    raiz.updateMatrixWorld(true);
    raiz.traverse((o) => {
      const b = o as Bone;
      if (!b.isBone || !(HUESOS as readonly string[]).includes(b.name)) return;
      const mundo = b.getWorldQuaternion(new Quaternion());
      this.huesos.set(b.name as Hueso, {
        hueso: b,
        local: b.quaternion.clone(),
        mundo,
        mundoInv: mundo.clone().invert(),
      });
    });
  }

  /** Cuántos de los 14 huesos encontró. Cero = el GLB no trae esqueleto. */
  get cantidad(): number {
    return this.huesos.size;
  }

  aplicar(pose: PoseCuerpo): void {
    for (const [nombre, r] of this.huesos) {
      const [x, y, z] = pose[nombre];
      this.e.set(x, y, z, "XYZ");
      this.q.setFromEuler(this.e);
      // reposo_mundo⁻¹ · giro · reposo_mundo
      this.q.premultiply(r.mundoInv).multiply(r.mundo);
      r.hueso.quaternion.copy(r.local).multiply(this.q);
    }
  }
}
