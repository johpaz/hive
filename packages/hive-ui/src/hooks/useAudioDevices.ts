/**
 * Micrófonos y salidas para la interfaz: la lista y el nivel de entrada.
 *
 * Lo usan la consola de voz y Ajustes, que muestran los mismos controles con
 * pieles distintas.
 */

import { useEffect, useRef, useState } from "react";
import { nombresBluetooth, type DispositivoAudio } from "@/lib/realtime/dispositivos";
import { cargarSoloAltavoz, marcarSoloAltavoz, prepararEntradas } from "@/lib/realtime/soloAltavoz";
import { getMediaEngine, type MicPort } from "@/lib/realtime/engine";
import { getSpectrumTaps } from "@/stores/realtimeStore";

/**
 * Aviso interno de "vuelve a mirar la lista".
 *
 * Hasta que no se concede el permiso de micrófono el navegador entrega los
 * dispositivos sin nombre, así que la primera lista puede ser una fila de
 * "Micrófono 1, Micrófono 2". En cuanto el medidor abre el micrófono los
 * nombres aparecen, y con este aviso la lista se rehace sola en vez de dejar
 * al usuario eligiendo entre números.
 */
const REFRESCAR = "hive-audio-devices";

export function avisarDispositivos(): void {
  window.dispatchEvent(new Event(REFRESCAR));
}

/** Marca (o desmarca) un aparato como solo altavoz y avisa a las listas abiertas. */
export function marcarEntradaSoloAltavoz(nombre: string, soloAltavoz: boolean): void {
  marcarSoloAltavoz(nombre, soloAltavoz);
  avisarDispositivos();
}

export function useDispositivosAudio(): {
  entradas: DispositivoAudio[];
  /** Micrófonos que la persona marcó como solo altavoz. */
  ocultas: DispositivoAudio[];
  salidas: DispositivoAudio[];
  /** Por qué no hay salidas que elegir, cuando no las hay. */
  motivoSalidas: string | null;
} {
  const [entradas, setEntradas] = useState<DispositivoAudio[]>([]);
  const [ocultas, setOcultas] = useState<DispositivoAudio[]>([]);
  const [salidas, setSalidas] = useState<DispositivoAudio[]>([]);
  const [motivoSalidas, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      const motor = getMediaEngine();
      void Promise.all([motor.listInputs(), nombresBluetooth()]).then(([crudas, nombresBt]) => {
        if (!vivo) return;
        const { visibles, ocultas: marcadas } = prepararEntradas(crudas, nombresBt, cargarSoloAltavoz());
        setEntradas(visibles);
        setOcultas(marcadas);
      });
      void motor.listOutputs().then((r) => {
        if (!vivo) return;
        setSalidas(r.lista);
        setMotivo(r.motivo);
      });
    };
    cargar();
    // Conectar o quitar un aparato cambia la lista sin que nadie recargue nada.
    navigator.mediaDevices?.addEventListener?.("devicechange", cargar);
    window.addEventListener(REFRESCAR, cargar);
    return () => {
      vivo = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", cargar);
      window.removeEventListener(REFRESCAR, cargar);
    };
  }, []);

  return { entradas, ocultas, salidas, motivoSalidas };
}

/**
 * Nivel de entrada (0–1) del micrófono elegido, para la barra que confirma que
 * capta algo.
 *
 * Con la llamada abierta se lee del analizador que ya cuelga del micrófono real
 * — abrir un segundo flujo del mismo aparato es pedirle problemas al sistema —.
 * En reposo abre uno propio y lo cierra al salir.
 */
export function useNivelMicrofono(deviceId: string, activo: boolean, enVivo: boolean): number {
  const [nivel, setNivel] = useState(0);
  const nivelRef = useRef(0);

  useEffect(() => {
    if (!activo) {
      setNivel(0);
      return;
    }

    let vivo = true;
    let raf = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let datos: Uint8Array<ArrayBuffer> | null = null;
    // Motor nativo: el micrófono no es de la página, así que se mide por el
    // propio motor en vez de abrir uno con getUserMedia (cuyos ids no valen).
    let micNativo: MicPort | null = null;
    let rmsNativo = 0;

    const pintar = () => {
      if (!vivo) return;
      let valor = 0;
      if (enVivo) {
        valor = getSpectrumTaps().mic?.sample() ?? 0;
      } else if (micNativo) {
        // Misma escala que el espectro: una voz normal (rms ~0,1) llena media barra.
        valor = Math.min(1, rmsNativo * 3.2);
      } else if (analyser && datos) {
        analyser.getByteFrequencyData(datos);
        let suma = 0;
        for (const v of datos) suma += v;
        // Misma ganancia que el visualizador de la escena, para que la barra se
        // mueva igual antes y durante la llamada.
        valor = Math.min(1, (suma / (datos.length * 255)) * 3.2);
      }
      // Ataque rápido, caída lenta: si no, la barra parpadea entre sílabas.
      nivelRef.current = valor > nivelRef.current
        ? nivelRef.current + (valor - nivelRef.current) * 0.5
        : nivelRef.current + (valor - nivelRef.current) * 0.12;
      setNivel(nivelRef.current);
      raf = requestAnimationFrame(pintar);
    };

    if (enVivo) {
      raf = requestAnimationFrame(pintar);
    } else if (getMediaEngine().kind === "native") {
      const mic = getMediaEngine().createMic((pcm) => {
        rmsNativo = rmsPcm16(pcm);
      }, deviceId || null);
      micNativo = mic;
      mic.start().then(() => {
        if (!vivo) {
          mic.stop();
          return;
        }
        avisarDispositivos();
        raf = requestAnimationFrame(pintar);
      }).catch(() => {
        micNativo = null; // la barra se queda quieta; el error real sale al llamar
      });
    } else {
      const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
      if (deviceId) audio.deviceId = { exact: deviceId };
      navigator.mediaDevices
        .getUserMedia({ audio })
        .then((s) => {
          if (!vivo) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          // Con el permiso ya concedido los nombres dejan de estar ocultos.
          avisarDispositivos();
          context = new AudioContext();
          analyser = context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.7;
          context.createMediaStreamSource(s).connect(analyser);
          datos = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
          raf = requestAnimationFrame(pintar);
        })
        .catch(() => {
          // Sin permiso o sin micrófono la barra se queda quieta; el selector
          // sigue sirviendo y el error real se cuenta al abrir la llamada.
        });
    }

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      micNativo?.stop();
      nivelRef.current = 0;
    };
  }, [deviceId, activo, enVivo]);

  return nivel;
}

/** RMS (0–1) de un bloque PCM16 little-endian. */
export function rmsPcm16(pcm: ArrayBuffer): number {
  const muestras = new Int16Array(pcm);
  if (!muestras.length) return 0;
  let suma = 0;
  for (const m of muestras) suma += (m / 0x8000) ** 2;
  return Math.sqrt(suma / muestras.length);
}

/** Por debajo de esto la barra está, a todos los efectos, sin señal. */
const NIVEL_MUDO = 0.004;
/** Cuánto silencio seguido hace falta para avisar: una pausa al hablar no cuenta. */
const MUDO_TRAS_MS = 4_000;

/**
 * ¿Lleva un rato sin llegar nada del micrófono elegido?
 *
 * Un micrófono silenciado o sin nada enchufado no da error: da ceros. Sin este
 * aviso la persona habla, nada responde y no hay nada en pantalla que explique
 * por qué. El caso real: el predeterminado era el conector analógico de la
 * placa, vacío, y la barra simplemente no se movía.
 */
export function useMicrofonoMudo(nivel: number, activo: boolean): boolean {
  const [mudo, setMudo] = useState(false);
  const ultimaSenal = useRef(0);

  useEffect(() => {
    ultimaSenal.current = Date.now();
    setMudo(false);
  }, [activo]);

  useEffect(() => {
    if (nivel > NIVEL_MUDO) {
      ultimaSenal.current = Date.now();
      setMudo((previo) => (previo ? false : previo));
    }
  }, [nivel]);

  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => {
      if (Date.now() - ultimaSenal.current > MUDO_TRAS_MS) setMudo(true);
    }, 500);
    return () => clearInterval(id);
  }, [activo]);

  return activo && mudo;
}
