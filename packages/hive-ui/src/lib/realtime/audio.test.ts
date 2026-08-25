import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RealtimePlayer } from "./audio";

/**
 * Contexto de audio de mentira: lo justo para que `RealtimePlayer` funcione sin
 * un motor detrás. `currentTime` no avanza a propósito — es justo el caso que
 * hundió la primera versión de la compuerta.
 */
class ContextoFalso {
  state = "running";
  currentTime = 0;
  destination = {};
  createGain() {
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      minDecibels: 0,
      maxDecibels: 0,
      frequencyBinCount: 64,
      connect() {},
      disconnect() {},
      getByteFrequencyData() {},
    };
  }
  createBuffer(_canales: number, muestras: number, rate: number) {
    return { duration: muestras / rate, getChannelData: () => new Float32Array(muestras) };
  }
  createBufferSource() {
    // `onended` nunca se dispara, como en el motor de la app de escritorio
    // cuando el contexto queda interrumpido o le mueven el aparato de salida.
    return { buffer: null, onended: null, connect() {}, start() {}, stop() {} };
  }
  addEventListener() {}
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

/** Un segundo de voz a 24 kHz, que es lo que entrega la API Live. */
const UN_SEGUNDO = new Int16Array(24_000).buffer;

describe("compuerta de manos libres", () => {
  let player: RealtimePlayer;

  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as any).AudioContext = ContextoFalso;
    player = new RealtimePlayer();
    await player.resume();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).AudioContext;
  });

  test("en reposo el micrófono está abierto", () => {
    expect(player.estaHablando()).toBe(false);
  });

  test("mientras suena su voz, cerrada", () => {
    player.enqueue(UN_SEGUNDO);
    expect(player.estaHablando()).toBe(true);
    vi.advanceTimersByTime(1_000);
    // Sigue cerrada: el altavoz de un televisor va por detrás del reloj.
    expect(player.estaHablando()).toBe(true);
  });

  test("se reabre sola pasada la cola, aunque ningún nodo avise de que terminó", () => {
    // La regresión que dejó el micrófono mudo: la versión anterior contaba
    // nodos vivos, y sin `onended` esa cuenta no bajaba nunca.
    player.enqueue(UN_SEGUNDO);
    vi.advanceTimersByTime(1_800);
    expect(player.estaHablando()).toBe(false);
  });

  test("interrumpir la reabre en el acto", () => {
    player.enqueue(UN_SEGUNDO);
    expect(player.estaHablando()).toBe(true);
    player.interrupt();
    expect(player.estaHablando()).toBe(false);
  });

  test("nunca puede quedarse cerrada más allá del tope", () => {
    // Con el reloj del contexto parado, la cola programada crece sin freno:
    // media hora de audio encolado no puede significar media hora sin escuchar.
    for (let i = 0; i < 1_800; i++) player.enqueue(UN_SEGUNDO);
    vi.advanceTimersByTime(4_700);
    expect(player.estaHablando()).toBe(false);
  });

  test("cada bloque nuevo extiende el plazo", () => {
    player.enqueue(UN_SEGUNDO);
    vi.advanceTimersByTime(1_500);
    player.enqueue(UN_SEGUNDO);
    vi.advanceTimersByTime(1_000);
    expect(player.estaHablando()).toBe(true);
  });
});
