import type { Vector3 } from "three";
import type { DeskState } from "@/modules/office3d/state/useOfficeModel";

/** Posición del núcleo central (la reina). */
export const CORE_POSITION: [number, number, number] = [0, 0, 0];
/** Altura del anillo de trabajo, donde las abejas delegadas orbitan el núcleo. */
export const WORK_RING_RADIUS = 4.2;
const WORK_RING_Y = 4.4;
/** Radio de aparcamiento de agentes desactivados. */
export const DOCK_RADIUS = 20;

export interface BeeOrbitSpec {
  /** Radio de la capa hogar. */
  radius: number;
  /** Altura base de la capa. */
  yBase: number;
  /** Inclinación de la órbita (amplitud vertical de la elipse). */
  inclination: number;
  /** Fase inicial (rad). */
  phase: number;
  /** Velocidad angular base en idle (rad/s). */
  angularSpeed: number;
}

interface Shell {
  radius: number;
  yBase: number;
  inclination: number;
}

const SHELLS: Shell[] = [
  { radius: 7.5, yBase: 2.8, inclination: 0.55 },
  { radius: 10.5, yBase: 3.8, inclination: 0.9 },
  { radius: 13.5, yBase: 4.8, inclination: 1.25 },
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Órbita hogar determinista de una abeja: reparte a los agentes en 3 capas
 * (shells) alrededor del núcleo con fases espaciadas. Mismo índice/count →
 * misma órbita, estable entre renders y sesiones.
 */
export function beeOrbit(index: number, count: number): BeeOrbitSpec {
  const shell = SHELLS[index % SHELLS.length];
  const slot = Math.floor(index / SHELLS.length);
  const perShell = Math.max(1, Math.ceil(count / SHELLS.length));
  return {
    radius: shell.radius,
    yBase: shell.yBase,
    inclination: shell.inclination,
    phase: (slot * Math.PI * 2) / perShell + (index % SHELLS.length) * GOLDEN * 0.37,
    angularSpeed: 0.05 + ((index * 7) % 5) * 0.016,
  };
}

/** Posición angular en una órbita: círculo inclinado con leve deriva vertical. */
export function orbitPosition(
  spec: BeeOrbitSpec,
  radius: number,
  yBase: number,
  angle: number,
  _t: number,
): [number, number, number] {
  return [
    Math.cos(angle) * radius,
    yBase + Math.sin(angle) * spec.inclination,
    Math.sin(angle) * radius,
  ];
}

/** Multiplicador de velocidad angular según estado. */
export function speedFactor(state: DeskState, hasTask: boolean): number {
  if (state === "disabled" || state === "archived") return 0;
  if (state === "tool_call") return 0.65;
  if (state === "thinking") return hasTask ? 0.42 : 0.2;
  if (state === "stuck") return 0.08;
  return 0;
}

/** Radio objetivo según estado: delegada → anillo de trabajo; si no, su capa. */
export function targetRadius(state: DeskState, hasTask: boolean, homeRadius: number): number {
  if (state === "disabled" || state === "archived") return DOCK_RADIUS;
  return hasTask ? WORK_RING_RADIUS : homeRadius;
}

/** Altura objetivo según estado. */
export function targetY(state: DeskState, hasTask: boolean, homeY: number): number {
  if (state === "disabled" || state === "archived") return 1.4;
  return hasTask ? WORK_RING_Y : homeY;
}

/** Estado mutable de una abeja dentro del enjambre (lo muta SwarmDriver). */
export interface BeeState {
  pos: Vector3;
  prevPos: Vector3;
  angle: number;
  radius: number;
  y: number;
  speedMul: number;
}

export type SwarmRef = { current: Map<string, BeeState> };
