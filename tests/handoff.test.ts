/**
 * Traspaso estructurado de la compactación (handoff.ts): parseo tolerante de la
 * respuesta del modelo, render con prioridad y prompt. Puro: sin LLM ni base de datos.
 */

import { describe, test, expect } from "bun:test";
import {
  parseHandoff,
  renderHandoff,
  buildHandoffPrompt,
  type Handoff,
} from "../packages/core/src/agent/handoff";

const full: Handoff = {
  objective: "Migrar la facturación a Alegra",
  facts: ["API base: https://api.alegra.com/v1", "El usuario prefiere respuestas cortas"],
  changes: ["Creado src/billing/alegra.ts (verificado)"],
  verification: ["bun test billing: 12 pass"],
  dead_ends: ["Basic auth falla con 401; usar token"],
  plan: ["Mapear impuestos", "Probar nota crédito"],
};

describe("parseHandoff", () => {
  test("lee un JSON limpio", () => {
    expect(parseHandoff(JSON.stringify(full))).toEqual(full);
  });

  test("tolera cercas de código y texto alrededor", () => {
    const raw = "Aquí va:\n```json\n" + JSON.stringify(full) + "\n```";
    expect(parseHandoff(raw)?.objective).toBe(full.objective);
  });

  test("un campo de lista que llega como string se vuelve lista", () => {
    const h = parseHandoff('{"objective":"x","facts":"un solo hecho"}');
    expect(h?.facts).toEqual(["un solo hecho"]);
    expect(h?.plan).toEqual([]);
  });

  test("devuelve null si no es JSON o no trae nada útil", () => {
    expect(parseHandoff("El usuario quiere migrar a Alegra.")).toBeNull();
    expect(parseHandoff('{"objective":"x"')).toBeNull();
    expect(parseHandoff("[1,2,3]")).toBeNull();
    expect(parseHandoff('{"changes":["algo"],"verification":["algo"]}')).toBeNull();
  });

  test("recorta elementos largos y listas enormes", () => {
    const h = parseHandoff(JSON.stringify({
      objective: "o".repeat(2000),
      facts: Array.from({ length: 100 }, (_, i) => `hecho ${i} ` + "x".repeat(2000)),
    }))!;
    expect(h.objective.length).toBe(400);
    expect(h.facts.length).toBe(30);
    expect(h.facts[0]!.length).toBe(500);
  });
});

describe("renderHandoff", () => {
  test("incluye las secciones con contenido y omite las vacías", () => {
    const text = renderHandoff({ ...full, changes: [], verification: [] });
    expect(text).toContain("Objetivo: Migrar la facturación a Alegra");
    expect(text).toContain("- API base: https://api.alegra.com/v1");
    expect(text).not.toContain("Cambios aplicados");
    expect(text).not.toContain("Verificación");
  });

  test("ordena por prioridad: hechos y callejones antes que cambios y verificación", () => {
    const text = renderHandoff(full);
    const at = (s: string) => text.indexOf(s);
    expect(at("Hechos establecidos")).toBeLessThan(at("Callejones sin salida"));
    expect(at("Callejones sin salida")).toBeLessThan(at("Plan restante"));
    expect(at("Plan restante")).toBeLessThan(at("Cambios aplicados"));
    expect(at("Cambios aplicados")).toBeLessThan(at("Verificación"));
  });

  test("un recorte de cola conserva hechos y callejones sin salida", () => {
    const cut = renderHandoff(full).slice(0, 220);
    expect(cut).toContain("API base");
    expect(cut).toContain("Callejones");
  });
});

describe("buildHandoffPrompt", () => {
  test("incorpora el traspaso previo solo si existe", () => {
    const sin = buildHandoffPrompt({ transcript: "[USER]: hola", messageCount: 1 });
    const con = buildHandoffPrompt({ transcript: "[USER]: hola", messageCount: 1, previous: "Objetivo: X" });
    expect(sin).not.toContain("Previous handoff");
    expect(con).toContain("Previous handoff");
    expect(con).toContain("Objetivo: X");
  });

  test("pide los seis campos", () => {
    const p = buildHandoffPrompt({ transcript: "t", messageCount: 1 });
    for (const k of ["objective", "facts", "changes", "verification", "dead_ends", "plan"]) {
      expect(p).toContain(`"${k}"`);
    }
  });
});
