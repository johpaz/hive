// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rmsPcm16, useMicrofonoMudo } from "./useAudioDevices";

describe("rmsPcm16", () => {
  test("silencio da cero y una onda a escala completa da uno", () => {
    expect(rmsPcm16(new Int16Array(640).buffer)).toBe(0);
    expect(rmsPcm16(new Int16Array(640).fill(-32768).buffer)).toBeCloseTo(1, 3);
  });

  test("un bloque vacío no rompe", () => {
    expect(rmsPcm16(new ArrayBuffer(0))).toBe(0);
  });
});

describe("useMicrofonoMudo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("avisa tras unos segundos sin señal", () => {
    const { result } = renderHook(({ n }) => useMicrofonoMudo(n, true), { initialProps: { n: 0 } });
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(false); // una pausa corta no cuenta
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(true);
  });

  test("se quita en cuanto vuelve a llegar señal", () => {
    const { result, rerender } = renderHook(({ n }) => useMicrofonoMudo(n, true), { initialProps: { n: 0 } });
    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(true);
    rerender({ n: 0.2 });
    expect(result.current).toBe(false);
  });

  test("hablar de vez en cuando mantiene el aviso apagado", () => {
    const { result, rerender } = renderHook(({ n }) => useMicrofonoMudo(n, true), { initialProps: { n: 0 } });
    for (let i = 0; i < 4; i++) {
      act(() => void vi.advanceTimersByTime(2_500));
      rerender({ n: i % 2 ? 0.1 : 0.12 });
    }
    expect(result.current).toBe(false);
  });

  test("inactivo nunca avisa", () => {
    const { result } = renderHook(() => useMicrofonoMudo(0, false));
    act(() => void vi.advanceTimersByTime(20_000));
    expect(result.current).toBe(false);
  });
});
