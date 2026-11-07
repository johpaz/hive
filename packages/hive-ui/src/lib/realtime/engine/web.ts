/**
 * Motor de medios del navegador: WebAudio + getUserMedia + getDisplayMedia.
 *
 * No contiene lógica propia: envuelve las clases que ya existían en
 * `audio.ts`, `camera.ts`, `screen.ts` y `dispositivos.ts`, sin cambiar su
 * comportamiento. Es el motor de la web, del móvil y el respaldo del escritorio.
 */

import { RealtimeMic, RealtimePlayer, describeMicError } from "@/lib/realtime/audio";
import { RealtimeCamera, describeCameraError } from "@/lib/realtime/camera";
import { RealtimeScreen, describeScreenError } from "@/lib/realtime/screen";
import { listarEntradas, listarSalidas } from "@/lib/realtime/dispositivos";
import type { MediaEngine } from "@/lib/realtime/engine/types";

export const webMediaEngine: MediaEngine = {
  kind: "web",
  // Tiene la cancelación del navegador, pero con un altavoz abierto no basta:
  // por eso existe el modo manos libres que calla el micrófono.
  cancelaEco: false,
  createMic: (onFrame, deviceId) => new RealtimeMic(onFrame, deviceId),
  createPlayer: () => new RealtimePlayer(),
  createCamera: (onFrame) => new RealtimeCamera(onFrame),
  createScreen: (onFrame, onEnded) => new RealtimeScreen(onFrame, onEnded),
  listInputs: listarEntradas,
  listOutputs: listarSalidas,
  describeMicError,
  describeCameraError,
  describeScreenError,
};
