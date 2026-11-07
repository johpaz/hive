import { afterEach, describe, expect, test, vi } from "vitest";
import { bytesABase64, crearMotorHibrido, crearMotorNativo, nativoDisponible, type TauriCore } from "./native";
import { webMediaEngine } from "./web";

/** Un `TauriCore` de mentira que registra las llamadas y deja empujar frames de micrófono. */
function nucleoFalso(respuestas: Record<string, unknown> = {}) {
  let siguienteToken = 0;
  const llamadas: Array<{ cmd: string; args: unknown }> = [];
  const canales: Array<{ onmessage: (m: any) => void }> = [];

  class Channel {
    onmessage: (m: any) => void = () => {};
    constructor() {
      canales.push(this);
    }
  }

  const core: TauriCore = {
    invoke: (async (cmd: string, args?: unknown) => {
      llamadas.push({ cmd, args });
      if (/^media_(mic|camera|screen)_start$/.test(cmd) && !(cmd in respuestas)) return ++siguienteToken;
      const r = respuestas[cmd];
      if (r instanceof Error || (r && typeof r === "object" && "kind" in (r as object) && (r as any).__falla)) {
        throw r;
      }
      return r;
    }) as TauriCore["invoke"],
    Channel: Channel as unknown as TauriCore["Channel"],
  };
  const de = (cmd: string) => llamadas.filter((l) => l.cmd === cmd);
  return { core, llamadas, canales, de };
}

const pcm = (muestras: number) => new Int16Array(muestras).buffer;

afterEach(() => vi.useRealTimers());

describe("reproductor nativo", () => {
  test("abre la salida elegida y manda los bytes crudos, no una lista", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.usarSalida("pipewire:tv");
    await player.resume();

    expect(de("media_player_start")[0]?.args).toEqual({ deviceId: "pipewire:tv" });

    player.enqueue(pcm(2400));
    const enviado = de("media_player_enqueue")[0]?.args;
    expect(enviado).toBeInstanceOf(Uint8Array);
    expect((enviado as Uint8Array).byteLength).toBe(4800);
  });

  test("no encola nada antes de abrir la salida", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    player.enqueue(pcm(2400));
    expect(de("media_player_enqueue")).toHaveLength(0);
  });

  test("varias aperturas simultáneas comparten un solo intento", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await Promise.all([player.resume(), player.resume(), player.resume()]);
    expect(de("media_player_start")).toHaveLength(1);
  });

  test("estaHablando sigue al audio encolado y el barge-in lo corta al instante", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.resume();

    expect(player.estaHablando()).toBe(false);
    player.enqueue(pcm(24_000)); // 1 s de voz
    expect(player.estaHablando()).toBe(true);
    expect(player.isSpeaking).toBe(true);

    player.interrupt();
    expect(player.estaHablando()).toBe(false);
    expect(player.isSpeaking).toBe(false);
    expect(de("media_player_interrupt")).toHaveLength(1);
  });

  test("avisa de que se quedó callado cuando termina lo encolado", async () => {
    vi.useFakeTimers();
    const { core } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    const idle = vi.fn();
    player.onIdle = idle;
    await player.resume();

    player.enqueue(pcm(12_000)); // 0,5 s
    vi.advanceTimersByTime(400);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  test("cambiar de salida con la llamada abierta reabre el dispositivo", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.resume();
    await player.usarSalida("pipewire:bluetooth");

    const aperturas = de("media_player_start");
    expect(aperturas).toHaveLength(2);
    expect(aperturas[1]?.args).toEqual({ deviceId: "pipewire:bluetooth" });
  });

  test("elegir salida en reposo no abre nada: se aplica al abrir", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.usarSalida("pipewire:tv");
    expect(de("media_player_start")).toHaveLength(0);
  });

  test("probar toca un tono por la salida", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.probar();
    expect(de("media_player_enqueue")).toHaveLength(1);
  });

  test("stop cierra la salida en el módulo nativo", async () => {
    const { core, de } = nucleoFalso();
    const player = crearMotorNativo(core).createPlayer();
    await player.resume();
    player.stop();
    expect(de("media_player_stop")).toHaveLength(1);
  });
});

describe("micrófono nativo", () => {
  test("entrega al llamador cada bloque que llega por el canal", async () => {
    const { core, canales, de } = nucleoFalso();
    const recibidos: ArrayBuffer[] = [];
    const mic = crearMotorNativo(core).createMic((b) => recibidos.push(b), "pipewire:yu7");
    await mic.start();

    expect(de("media_mic_start")[0]?.args).toMatchObject({ deviceId: "pipewire:yu7" });
    const bloque = pcm(640);
    canales[0]!.onmessage(bloque);
    expect(recibidos).toEqual([bloque]);
  });

  test("normaliza un bloque entregado como lista de bytes", async () => {
    const { core, canales } = nucleoFalso();
    const recibidos: ArrayBuffer[] = [];
    const mic = crearMotorNativo(core).createMic((b) => recibidos.push(b), null);
    await mic.start();
    canales[0]!.onmessage([1, 0, 2, 0]);
    expect(new Int16Array(recibidos[0]!)).toEqual(new Int16Array([1, 2]));
  });

  test("tras parar ya no entrega bloques", async () => {
    const { core, canales, de } = nucleoFalso();
    const recibidos: ArrayBuffer[] = [];
    const mic = crearMotorNativo(core).createMic((b) => recibidos.push(b), null);
    await mic.start();
    mic.stop();
    canales[0]!.onmessage(pcm(640));
    expect(recibidos).toHaveLength(0);
    expect(de("media_mic_stop")).toHaveLength(1);
  });

  test("cada micrófono cierra con su propio token, no con el de otro", async () => {
    const { core, de } = nucleoFalso();
    const medidor = crearMotorNativo(core).createMic(() => {}, null);
    const llamada = crearMotorNativo(core).createMic(() => {}, null);
    await medidor.start(); // token 1
    await llamada.start(); // token 2: relevo del medidor
    medidor.stop(); // cierre tardío del medidor
    llamada.stop();

    const cierres = de("media_mic_stop").map((c) => c.args);
    expect(cierres).toEqual([{ token: 1 }, { token: 2 }]);
  });

  test("parar un micrófono que nunca llegó a abrirse no manda ningún cierre", () => {
    const { core, de } = nucleoFalso();
    crearMotorNativo(core).createMic(() => {}, null).stop();
    expect(de("media_mic_stop")).toHaveLength(0);
  });

  test("si el módulo falla al abrir, el error llega al llamador y no deja el micrófono a medias", async () => {
    const { core, canales } = nucleoFalso({
      media_mic_start: Object.assign(new Error("x"), { kind: "busy" }),
    });
    const recibidos: ArrayBuffer[] = [];
    const mic = crearMotorNativo(core).createMic((b) => recibidos.push(b), null);
    await expect(mic.start()).rejects.toMatchObject({ kind: "busy" });
    canales[0]!.onmessage(pcm(640));
    expect(recibidos).toHaveLength(0);
  });
});

describe("dispositivos y errores", () => {
  test("lista las salidas del módulo con el formato de la interfaz", async () => {
    const { core } = nucleoFalso({
      media_list_devices: [{ id: "pipewire:tv", nombre: "32'TV", porDefecto: true }],
    });
    const { lista, motivo } = await crearMotorNativo(core).listOutputs();
    expect(lista).toEqual([{ id: "pipewire:tv", nombre: "32'TV", porDefecto: true }]);
    expect(motivo).toBeNull();
  });

  test("una lista vacía trae motivo, no un silencio", async () => {
    const { core } = nucleoFalso({ media_list_devices: [] });
    const { lista, motivo } = await crearMotorNativo(core).listOutputs();
    expect(lista).toEqual([]);
    expect(motivo).toMatch(/ninguna salida/);
  });

  test("si el listado falla, el motivo dice por qué", async () => {
    const { core } = nucleoFalso({
      media_list_devices: Object.assign(new Error("boom"), { message: "ACL rechazó el comando" }),
    });
    const { lista, motivo } = await crearMotorNativo(core).listOutputs();
    expect(lista).toEqual([]);
    expect(motivo).toBe("ACL rechazó el comando");
  });

  test("traduce el tipo de fallo a algo accionable", () => {
    const motor = crearMotorNativo(nucleoFalso().core);
    expect(motor.describeMicError({ kind: "permission_denied" })).toMatch(/negó el acceso/);
    expect(motor.describeMicError({ kind: "busy" })).toMatch(/Otra aplicación/);
    expect(motor.describeMicError({ kind: "no_device" })).toMatch(/ningún micrófono/);
    expect(motor.describeMicError({ kind: "other", message: "x" })).toMatch(/x$/);
    expect(motor.describeMicError("texto suelto")).toMatch(/texto suelto/);
  });

  test("el módulo se da por disponible solo si responde", async () => {
    expect(await nativoDisponible(nucleoFalso({ media_list_devices: [] }).core)).toBe(true);
    const roto = nucleoFalso().core;
    roto.invoke = (async () => {
      throw new Error("Command media_list_devices not allowed by ACL");
    }) as TauriCore["invoke"];
    expect(await nativoDisponible(roto)).toBe(false);
  });
});

describe("cancelación de eco", () => {
  test("el motor nativo declara que ya quita el eco; el web, que no", async () => {
    const { webMediaEngine } = await import("./web");
    expect(crearMotorNativo(nucleoFalso().core).cancelaEco).toBe(true);
    expect(webMediaEngine.cancelaEco).toBe(false);
  });
});

/** Un mensaje del módulo: `[etiqueta][carga…]`, como lo arma `VideoFrame::into_wire`. */
const mensaje = (etiqueta: number, ...carga: number[]) => new Uint8Array([etiqueta, ...carga]).buffer;

describe("cámara y pantalla nativas", () => {
  test("el fotograma del modelo se entrega en base64 y sin la etiqueta", async () => {
    const { core, canales, de } = nucleoFalso();
    const recibidos: Array<[string, string]> = [];
    const camara = crearMotorNativo(core).createCamera((b64, mime) => recibidos.push([b64, mime]));
    await camara.start();

    expect(de("media_camera_start")).toHaveLength(1);
    canales[0]!.onmessage(mensaje(0, 0xff, 0xd8, 0xff));
    expect(recibidos).toEqual([[btoa(String.fromCharCode(0xff, 0xd8, 0xff)), "image/jpeg"]]);
  });

  test("la vista previa no sale hacia el modelo", async () => {
    const { core, canales } = nucleoFalso();
    const recibidos: string[] = [];
    const camara = crearMotorNativo(core).createCamera((b64) => recibidos.push(b64));
    await camara.start();
    canales[0]!.onmessage(mensaje(1, 1, 2, 3));
    canales[0]!.onmessage(mensaje(1, 1, 2, 3));
    expect(recibidos).toHaveLength(0);
  });

  test("cámara y pantalla se abren con su propio comando", async () => {
    const { core, de } = nucleoFalso();
    const motor = crearMotorNativo(core);
    await motor.createCamera(() => {}).start();
    await motor.createScreen(() => {}).start();
    expect(de("media_camera_start")).toHaveLength(1);
    expect(de("media_screen_start")).toHaveLength(1);
  });

  test("si la persona corta la compartición desde el sistema, se avisa y se cierra", async () => {
    const { core, canales, de } = nucleoFalso();
    const alTerminar = vi.fn();
    const pantalla = crearMotorNativo(core).createScreen(() => {}, alTerminar);
    await pantalla.start();

    canales[0]!.onmessage(mensaje(2));
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(de("media_screen_stop")[0]?.args).toEqual({ token: 1 });
  });

  test("tras parar ya no llegan fotogramas y se cierra con el token propio", async () => {
    const { core, canales, de } = nucleoFalso();
    const recibidos: string[] = [];
    const camara = crearMotorNativo(core).createCamera((b64) => recibidos.push(b64));
    await camara.start();
    camara.stop();
    canales[0]!.onmessage(mensaje(0, 1, 2));
    expect(recibidos).toHaveLength(0);
    expect(de("media_camera_stop")[0]?.args).toEqual({ token: 1 });
  });

  test("parar dos veces cierra una sola vez", async () => {
    const { core, de } = nucleoFalso();
    const camara = crearMotorNativo(core).createCamera(() => {});
    await camara.start();
    camara.stop();
    camara.stop();
    expect(de("media_camera_stop")).toHaveLength(1);
  });

  test("un mensaje vacío o con etiqueta desconocida se ignora sin romper", async () => {
    const { core, canales } = nucleoFalso();
    const recibidos: string[] = [];
    const camara = crearMotorNativo(core).createCamera((b64) => recibidos.push(b64));
    await camara.start();
    canales[0]!.onmessage(new ArrayBuffer(0));
    canales[0]!.onmessage(mensaje(9, 1, 2));
    canales[0]!.onmessage(mensaje(0)); // modelo sin carga
    expect(recibidos).toHaveLength(0);
  });

  test("si el módulo falla al abrir, el error llega al llamador", async () => {
    const { core } = nucleoFalso({
      media_screen_start: Object.assign(new Error("x"), { kind: "permission_denied" }),
    });
    const pantalla = crearMotorNativo(core).createScreen(() => {});
    await expect(pantalla.start()).rejects.toMatchObject({ kind: "permission_denied" });
    expect(pantalla.element).toBeNull();
  });

  test("traduce los fallos de cámara y de pantalla", () => {
    const motor = crearMotorNativo(nucleoFalso().core);
    expect(motor.describeCameraError({ kind: "busy" })).toMatch(/Otra aplicación/);
    expect(motor.describeCameraError({ kind: "no_device" })).toMatch(/ninguna cámara/);
    expect(motor.describeCameraError({ kind: "permission_denied" })).toMatch(/negó el acceso/);
    // Cancelar el diálogo del portal llega como permiso denegado: no es un error.
    expect(motor.describeScreenError({ kind: "permission_denied" })).toBe("No se compartió ninguna pantalla.");
    expect(motor.describeScreenError({ kind: "other", message: "boom" })).toMatch(/boom/);
  });
});

describe("bytesABase64", () => {
  test("coincide con btoa en bloques pequeños", () => {
    expect(bytesABase64(new Uint8Array([72, 105]))).toBe(btoa("Hi"));
  });

  test("no revienta la pila con un JPEG de 300 KB", () => {
    const grande = new Uint8Array(300_000).map((_, i) => i % 251);
    const b64 = bytesABase64(grande);
    expect(b64.length).toBe(Math.ceil(300_000 / 3) * 4);
    // Ida y vuelta.
    const vuelta = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(vuelta).toEqual(grande);
  });
});

describe("motor híbrido (escritorio por defecto)", () => {
  afterEach(() => vi.restoreAllMocks());

  test("el audio sigue siendo el del navegador y la cámara es la nativa", async () => {
    const { core, de } = nucleoFalso();
    const motor = crearMotorHibrido(core);
    expect(motor.kind).toBe("web");
    expect(motor.cancelaEco).toBe(false);
    expect(motor.createMic).toBe(webMediaEngine.createMic);
    expect(motor.createPlayer).toBe(webMediaEngine.createPlayer);
    expect(motor.createScreen).toBe(webMediaEngine.createScreen);

    await motor.createCamera(() => {}).start();
    expect(de("media_camera_start")).toHaveLength(1);
  });
});

describe("respaldo al navegador", () => {
  afterEach(() => vi.restoreAllMocks());

  const puertoFalso = () => ({
    element: null as HTMLElement | null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  });

  test("si el módulo nativo falla por algo suyo, la cámara se abre con el navegador", async () => {
    const respaldo = puertoFalso();
    vi.spyOn(webMediaEngine, "createCamera").mockReturnValue(respaldo);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { core, de } = nucleoFalso({
      media_camera_start: Object.assign(new Error("x"), { kind: "other" }),
    });
    const camara = crearMotorNativo(core).createCamera(() => {});
    await camara.start();

    expect(de("media_camera_start")).toHaveLength(1);
    expect(respaldo.start).toHaveBeenCalledTimes(1);
    camara.stop();
    expect(respaldo.stop).toHaveBeenCalledTimes(1);
  });

  test.each(["permission_denied", "busy", "no_device"])(
    "con %s NO se prueba con el navegador: el problema no es del motor",
    async (kind) => {
      const respaldo = puertoFalso();
      vi.spyOn(webMediaEngine, "createCamera").mockReturnValue(respaldo);
      const { core } = nucleoFalso({
        media_camera_start: Object.assign(new Error("x"), { kind }),
      });
      const camara = crearMotorNativo(core).createCamera(() => {});
      await expect(camara.start()).rejects.toMatchObject({ kind });
      expect(respaldo.start).not.toHaveBeenCalled();
    },
  );

  test("describe tanto un fallo nativo como uno del navegador", () => {
    const motor = crearMotorNativo(nucleoFalso().core);
    expect(motor.describeCameraError({ kind: "busy" })).toMatch(/Otra aplicación/);
    expect(motor.describeCameraError({ name: "NotFoundError" })).toMatch(/ninguna cámara/);
  });
});
