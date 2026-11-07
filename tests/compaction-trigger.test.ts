/**
 * El umbral de compactación con modelo: alto por defecto (0,65 del espacio útil), porque lo que sale de la
 * ventana ya se recupera sin modelo. Funciones puras: sin base ni red.
 */
import { describe, expect, test } from "bun:test";
import { resolveCompactionTrigger, transcriptLimits } from "../packages/core/src/agent/compaction";

describe("resolveCompactionTrigger", () => {
  test("por defecto 0,65 del espacio útil menos la parte fija (128K y 10K fijos → 56 560)", () => {
    expect(resolveCompactionTrigger({ window: 128_000 })).toBe(56_560);
  });

  test("una proporción menor baja el umbral (0,6 → 51 440)", () => {
    expect(resolveCompactionTrigger({ configured: 0.6, window: 128_000 })).toBe(51_440);
  });

  test("la parte fija medida le quita lugar al historial", () => {
    expect(resolveCompactionTrigger({ window: 128_000, fixedTokens: 25_000 })).toBe(41_560);
  });

  test("un valor mayor que 1 son tokens de historial, sin más cálculo", () => {
    expect(resolveCompactionTrigger({ configured: 40_000, window: 128_000 })).toBe(40_000);
  });

  test("ventana pequeña: proporcional, no un número fijo", () => {
    expect(resolveCompactionTrigger({ window: 32_768 })).toBe(7_039);
  });

  test("nunca por debajo de 2000 tokens", () => {
    expect(resolveCompactionTrigger({ window: 8_192 })).toBe(2_000);
  });

  test("con una parte fija enorme se acota a la mitad de la ventana", () => {
    expect(resolveCompactionTrigger({ window: 128_000, fixedTokens: 100_000 })).toBe(2_560);
  });

  test("nunca supera el 90 % del presupuesto de historial del compilador", () => {
    // ratio 1 en 128K con 10K fijos: 102 400 − 10 000 = 92 400 de presupuesto → techo 83 160.
    expect(resolveCompactionTrigger({ configured: 1, window: 128_000 })).toBe(83_160);
  });

  test("sin ventana conocida asume 128K", () => {
    expect(resolveCompactionTrigger({})).toBe(56_560);
  });
});

describe("transcriptLimits", () => {
  test("un modelo pequeño conserva los topes de siempre", () => {
    expect(transcriptLimits(32_768)).toEqual({ maxMsgs: 40, maxChars: 24_000 });
  });

  test("crece con la ventana, con tope", () => {
    expect(transcriptLimits(128_000)).toEqual({ maxMsgs: 74, maxChars: 44_800 });
    expect(transcriptLimits(1_000_000)).toEqual({ maxMsgs: 160, maxChars: 100_000 });
  });
});
