import { describe, it, expect } from "vitest";
import { beeOrbit, orbitPosition, speedFactor, targetRadius, WORK_RING_RADIUS, DOCK_RADIUS } from "./swarm";

describe("beeOrbit", () => {
  it("es determinista", () => {
    expect(beeOrbit(3, 11)).toEqual(beeOrbit(3, 11));
  });

  it("reparte a los agentes en las 3 capas", () => {
    const count = 11;
    const radii = new Set<number>();
    for (let i = 0; i < count; i++) radii.add(beeOrbit(i, count).radius);
    expect(radii.size).toBe(3);
    expect([...radii].sort((a, b) => a - b)).toEqual([7.5, 10.5, 13.5]);
  });

  it("asigna fases distintas dentro de cada capa (sin colisiones angulares)", () => {
    const count = 11;
    const byShell = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const o = beeOrbit(i, count);
      const list = byShell.get(o.radius) ?? [];
      list.push(o.phase);
      byShell.set(o.radius, list);
    }
    for (const phases of byShell.values()) {
      expect(new Set(phases.map((p) => p.toFixed(5))).size).toBe(phases.length);
    }
  });

  it("velocidades angulares dentro de rango de diseño", () => {
    for (let i = 0; i < 11; i++) {
      const s = beeOrbit(i, 11).angularSpeed;
      expect(s).toBeGreaterThanOrEqual(0.05);
      expect(s).toBeLessThanOrEqual(0.13);
    }
  });
});

describe("orbitPosition", () => {
  it("mantiene la proyección XZ en el radio dado", () => {
    const spec = beeOrbit(0, 11);
    const [x, , z] = orbitPosition(spec, spec.radius, spec.yBase, 1.234, 10);
    expect(Math.hypot(x, z)).toBeCloseTo(spec.radius, 5);
  });
});

describe("estado → cinemática", () => {
  it("una abeja delegada baja al anillo de trabajo", () => {
    expect(targetRadius("thinking", true, 12.5)).toBe(WORK_RING_RADIUS);
    expect(targetRadius("tool_call", true, 16)).toBe(WORK_RING_RADIUS);
  });

  it("sin tarea vuelve a su capa hogar", () => {
    expect(targetRadius("idle", false, 12.5)).toBe(12.5);
  });

  it("desactivada se aparca en la periferia", () => {
    expect(targetRadius("disabled", false, 9)).toBe(DOCK_RADIUS);
    expect(speedFactor("disabled", false)).toBeLessThan(0.5);
  });

  it("tool_call es el estado más rápido", () => {
    expect(speedFactor("tool_call", true)).toBeGreaterThan(speedFactor("thinking", true));
    expect(speedFactor("thinking", true)).toBeGreaterThan(speedFactor("idle", false));
  });
});
