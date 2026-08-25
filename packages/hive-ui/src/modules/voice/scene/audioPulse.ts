/**
 * Pulso de audio compartido por la escena.
 *
 * Los analizadores se leen UNA vez por fotograma y el resultado se comparte por
 * referencia mutable. Si cada pieza de la escena llamara a `sample()` por su
 * cuenta, el suavizado temporal se aplicaría varias veces por frame y el
 * movimiento saldría amortiguado de más — además de leer el FFT de gadre.
 */

import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import { SPECTRUM_BINS } from "@/lib/realtime/audio";
import { getSpectrumTaps } from "@/stores/realtimeStore";

export interface AudioPulse {
  /** Nivel general 0–1 de la voz del usuario. */
  mic: number;
  /** Nivel general 0–1 de la voz del modelo. */
  voice: number;
  micBins: Uint8Array;
  voiceBins: Uint8Array;
  /** Sube en el flanco de subida de cualquiera de las dos voces. */
  onset: number;
}

export function createAudioPulse(): AudioPulse {
  return {
    mic: 0,
    voice: 0,
    micBins: new Uint8Array(SPECTRUM_BINS),
    voiceBins: new Uint8Array(SPECTRUM_BINS),
    onset: 0,
  };
}

export type PulseRef = MutableRefObject<AudioPulse>;

export function useAudioPulse(): PulseRef {
  return useRef<AudioPulse>(createAudioPulse());
}

/**
 * Corre antes que el resto de la escena (prioridad negativa) para que todos los
 * componentes vean el mismo pulso en el mismo fotograma.
 */
export function AudioSampler({ pulse }: { pulse: PulseRef }) {
  useFrame(() => {
    const taps = getSpectrumTaps();
    const p = pulse.current;
    const micPrev = p.mic;
    const voicePrev = p.voice;

    p.mic = taps.mic ? taps.mic.sample() : p.mic * 0.9;
    p.voice = taps.player ? taps.player.sample() : p.voice * 0.9;
    if (taps.mic) p.micBins.set(taps.mic.bins);
    if (taps.player) p.voiceBins.set(taps.player.bins);

    const subida = Math.max(p.mic - micPrev, p.voice - voicePrev, 0);
    p.onset = Math.max(p.onset * 0.86, subida * 4);
  }, -10);

  return null;
}
