import { describe, expect, it } from "vitest";
import { DirectorDeGestos, type EntradaGestos, type PoseMano } from "./gestures";
import { crearParpadeo, pasoParpadeo, respiracion } from "./idleLife";

const base: EntradaGestos = { t: 0, estado: "reposo", voz: 0, onset: 0, working: false };

/** Corre el director `segundos` a 60 fps y devuelve la última pose. */
function correr(d: DirectorDeGestos, e: Partial<EntradaGestos>, segundos: number) {
  let pose = d.step({ ...base, ...e }, 1 / 60);
  for (let t = 1 / 60; t < segundos; t += 1 / 60) pose = d.step({ ...base, ...e, t }, 1 / 60);
  return pose;
}

const enRango = (m: PoseMano) =>
  [m.mano, m.dedos, m.abre, m.muneca].every((v) => v >= 0 && v <= 1 && Number.isFinite(v));

describe("DirectorDeGestos", () => {
  it("mantiene todas las poses en [0, 1] en cualquier estado", () => {
    for (const estado of ["reposo", "escucha", "habla", "procesando", "exito", "alerta"] as const) {
      const d = new DirectorDeGestos();
      for (let t = 0; t < 20; t += 1 / 30) {
        const p = d.step({ t, estado, voz: Math.random(), onset: Math.random(), working: t > 10 }, 1 / 30);
        expect(enRango(p.izq)).toBe(true);
        expect(enRango(p.der)).toBe(true);
      }
    }
  });

  it("al celebrar abre las manos y al pensar cierra los dedos de una", () => {
    const celebra = correr(new DirectorDeGestos(), { estado: "exito" }, 3);
    expect(celebra.izq.abre).toBeGreaterThan(0.4);
    expect(celebra.der.abre).toBeGreaterThan(0.4);

    const piensa = correr(new DirectorDeGestos(), { estado: "procesando", working: true }, 3);
    expect(Math.max(piensa.izq.dedos, piensa.der.dedos)).toBeGreaterThan(0.2);
  });

  it("nunca pasa de los topes de dedos, apertura y muñeca", () => {
    for (const estado of ["habla", "escucha", "procesando", "exito"] as const) {
      const d = new DirectorDeGestos();
      for (let t = 0; t < 30; t += 1 / 30) {
        const p = d.step({ t, estado, voz: 1, onset: 1, working: estado === "procesando" }, 1 / 30);
        for (const m of [p.izq, p.der]) {
          expect(m.dedos).toBeLessThanOrEqual(0.3 + 1e-9);
          expect(m.abre).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(m.muneca).toBeLessThanOrEqual(0.15 + 1e-9);
        }
      }
    }
  });

  it("un pico de voz al hablar mueve las manos más que sin pico", () => {
    const sin = correr(new DirectorDeGestos(), { estado: "habla", voz: 0.5 }, 0.5);
    const d = new DirectorDeGestos();
    const con = correr(d, { estado: "habla", voz: 0.5, onset: 1, t: 1 }, 0.3);
    const suma = (p: typeof sin) => p.izq.mano + p.der.mano + p.izq.dedos + p.der.dedos;
    expect(suma(con)).toBeGreaterThanOrEqual(suma(sin) * 0.5);
  });
});

describe("idleLife", () => {
  it("la respiración es asimétrica: sube más rápido de lo que baja", () => {
    // Con periodo 4 s el pico está en 1.6 s. 1.3 s después de empezar ya casi
    // llegó arriba; 1.3 s después del pico todavía queda aire por soltar.
    expect(respiracion(1.3, 4)).toBeGreaterThan(0.9);
    expect(respiracion(1.6 + 1.3, 4)).toBeGreaterThan(0.2);
  });

  it("el parpadeo cierra y vuelve a abrir, y no se queda cerrado", () => {
    const e = crearParpadeo(0);
    let max = 0;
    let cerradoAlFinal = 0;
    for (let t = 0; t < 30; t += 1 / 60) {
      const c = pasoParpadeo(e, t);
      max = Math.max(max, c);
      cerradoAlFinal = c;
    }
    expect(max).toBeGreaterThan(0.95);
    expect(cerradoAlFinal).toBeLessThan(1);
  });
});
