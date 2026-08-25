/**
 * Energía de la conversación, compartida con el fondo.
 *
 * El telón y el polen necesitan saber si alguien está hablando, pero leer el
 * espectro por su cuenta significaría muestrear el FFT varias veces por
 * fotograma. Esta sonda lo deriva una vez del pulso ya calculado y lo deja en
 * una referencia mutable.
 */

import { useFrame } from "@react-three/fiber";
import type { PulseRef } from "./audioPulse";

interface EnergyProbeProps {
  pulse: PulseRef;
  energyRef: { current: number };
}

export function EnergyProbe({ pulse, energyRef }: EnergyProbeProps) {
  useFrame((_, delta) => {
    const p = pulse.current;
    const objetivo = Math.max(p.voice, p.mic * 0.7);
    // Sube rápido con la sílaba y baja despacio: el fondo no debe parpadear.
    const k = objetivo > energyRef.current ? 8 : 1.6;
    energyRef.current += (objetivo - energyRef.current) * Math.min(1, delta * k);
  }, -9);

  return null;
}
