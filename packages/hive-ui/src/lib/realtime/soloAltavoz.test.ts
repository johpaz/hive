// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DispositivoAudio } from "./dispositivos";
import { cargarSoloAltavoz, marcarSoloAltavoz, parecerBluetooth, prepararEntradas } from "./soloAltavoz";

const d = (nombre: string, extra: Partial<DispositivoAudio> = {}): DispositivoAudio => ({
  id: nombre,
  nombre,
  porDefecto: false,
  ...extra,
});

/**
 * `localStorage` no existe en este entorno de pruebas (Node reciente + jsdom):
 * se sustituye por uno en memoria. El código de producción ya lo envuelve en
 * try/catch, que es justo lo que cubre el caso de que no esté.
 */
beforeEach(() => {
  const datos = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
  });
});

describe("parecerBluetooth", () => {
  test("lo sabe por el motor cuando el motor lo dice", () => {
    expect(parecerBluetooth(d("Algo", { bluetooth: true }), [])).toBe(true);
  });

  test("lo sabe por los nombres que da el sistema, aunque la etiqueta sea pelada", () => {
    // El caso real: WebKit lista el parlante como «BS-2», sin pista alguna.
    expect(parecerBluetooth(d("BS-2"), ["BS-2"])).toBe(true);
    expect(parecerBluetooth(d("bs-2"), ["BS-2"])).toBe(true);
    expect(parecerBluetooth(d("BS-2 Hands-Free"), [])).toBe(true);
  });

  test("lo sabe por la etiqueta cuando el sistema no ayuda (Windows, macOS)", () => {
    expect(parecerBluetooth(d("Headset (JBL Hands-Free AG Audio)"), [])).toBe(true);
    expect(parecerBluetooth(d("Auriculares Bluetooth"), [])).toBe(true);
  });

  test("un micrófono normal no se marca", () => {
    expect(parecerBluetooth(d("YU7 Estéreo analógico"), ["BS-2"])).toBe(false);
    expect(parecerBluetooth(d("Ryzen HD Audio Controller"), ["BS-2"])).toBe(false);
  });

  test("un nombre corto del sistema no marca etiquetas que solo lo contienen", () => {
    expect(parecerBluetooth(d("TV Studio USB"), ["TV"])).toBe(true); // prefijo + espacio: es "TV …"
    expect(parecerBluetooth(d("Activity Monitor Mic"), ["TV"])).toBe(false);
    expect(parecerBluetooth(d("HDTV Capture"), ["TV"])).toBe(false);
  });

  test("un nombre vacío del sistema no marca nada", () => {
    expect(parecerBluetooth(d("Cualquiera"), ["", "  "])).toBe(false);
  });
});

describe("prepararEntradas", () => {
  const lista = [d("BS-2"), d("Web Camera"), d("Ryzen HD Audio"), d("YU7")];

  test("los Bluetooth van al final y el resto conserva su orden", () => {
    const { visibles } = prepararEntradas(lista, ["BS-2"], []);
    expect(visibles.map((x) => x.nombre)).toEqual(["Web Camera", "Ryzen HD Audio", "YU7", "BS-2"]);
    expect(visibles.at(-1)?.bluetooth).toBe(true);
    expect(visibles[0]?.bluetooth).toBe(false);
  });

  test("lo marcado como solo altavoz sale de la lista y se guarda aparte", () => {
    const { visibles, ocultas } = prepararEntradas(lista, ["BS-2"], ["BS-2"]);
    expect(visibles.map((x) => x.nombre)).not.toContain("BS-2");
    expect(ocultas.map((x) => x.nombre)).toEqual(["BS-2"]);
  });

  test("ocultar un nombre que ya no está conectado no rompe nada", () => {
    const { visibles, ocultas } = prepararEntradas(lista, [], ["Aparato que se fue"]);
    expect(visibles).toHaveLength(4);
    expect(ocultas).toHaveLength(0);
  });

  test("no muta la lista que le dan", () => {
    const copia = JSON.stringify(lista);
    prepararEntradas(lista, ["BS-2"], ["BS-2"]);
    expect(JSON.stringify(lista)).toBe(copia);
  });
});

describe("persistencia", () => {
  test("marcar y desmarcar se recuerda", () => {
    expect(cargarSoloAltavoz()).toEqual([]);
    marcarSoloAltavoz("BS-2", true);
    expect(cargarSoloAltavoz()).toEqual(["BS-2"]);
    marcarSoloAltavoz("BS-2", false);
    expect(cargarSoloAltavoz()).toEqual([]);
  });

  test("marcar dos veces el mismo no lo duplica", () => {
    marcarSoloAltavoz("BS-2", true);
    marcarSoloAltavoz("BS-2", true);
    expect(cargarSoloAltavoz()).toEqual(["BS-2"]);
  });

  test("un valor corrupto en el almacenamiento se ignora", () => {
    localStorage.setItem("hive-voice-speaker-only", "{no es json");
    expect(cargarSoloAltavoz()).toEqual([]);
    localStorage.setItem("hive-voice-speaker-only", JSON.stringify({ a: 1 }));
    expect(cargarSoloAltavoz()).toEqual([]);
    localStorage.setItem("hive-voice-speaker-only", JSON.stringify(["ok", 3, null]));
    expect(cargarSoloAltavoz()).toEqual(["ok"]);
  });
});

describe("sin almacenamiento", () => {
  test("si localStorage no existe, no se rompe y no recuerda nada", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(cargarSoloAltavoz()).toEqual([]);
    expect(() => marcarSoloAltavoz("BS-2", true)).not.toThrow();
  });
});
