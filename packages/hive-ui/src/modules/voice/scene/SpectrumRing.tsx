/**
 * Anillo de espectro: la firma de una voz, dibujada bin a bin.
 *
 * El desplazamiento se hace en el vertex shader a partir de una textura con el
 * espectro (128×1). Deformar la geometría en la CPU obligaría a subir un buffer
 * de vértices por fotograma; así sólo viaja un byte por bin.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  ClampToEdgeWrapping,
} from "three";
import { SPECTRUM_BINS } from "@/lib/realtime/audio";
import type { PulseRef } from "./audioPulse";

const VERT = /* glsl */ `
  uniform sampler2D uSpectrum;
  uniform float uAmount;
  uniform float uTime;
  varying float vEnergy;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // El ángulo del vértice elige el bin; el espejo evita la costura en 0 rad.
    float angle = atan(position.y, position.x);
    float t = abs(angle) / 3.14159265;
    float energy = texture2D(uSpectrum, vec2(t, 0.5)).r;
    vEnergy = energy;

    vec3 p = position;
    float radial = length(position.xy);
    if (radial > 0.0001) {
      p.xy += normalize(position.xy) * energy * uAmount;
    }
    p.z += sin(t * 18.0 + uTime * 1.4) * energy * uAmount * 0.35;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vEnergy;
  varying vec2 vUv;

  void main() {
    // El borde exterior se apaga: el anillo se lee como energía, no como aro.
    float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float glow = 0.25 + vEnergy * 1.6;
    gl_FragColor = vec4(uColor * glow, uOpacity * edge * (0.25 + vEnergy));
  }
`;

interface SpectrumRingProps {
  pulse: PulseRef;
  /** Qué voz dibuja: la del usuario o la del modelo. */
  source: "mic" | "voice";
  color: string;
  radius: number;
  amount?: number;
}

export function SpectrumRing({ pulse, source, color, radius, amount = 0.9 }: SpectrumRingProps) {
  const texture = useMemo(() => {
    const tex = new DataTexture(new Uint8Array(SPECTRUM_BINS), SPECTRUM_BINS, 1, RedFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uSpectrum: { value: texture },
          uAmount: { value: amount },
          uTime: { value: 0 },
          uColor: { value: new Color(color) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [texture, color, amount],
  );

  const nivel = useRef(0);

  useFrame((state, delta) => {
    const p = pulse.current;
    const bins = source === "mic" ? p.micBins : p.voiceBins;
    (texture.image.data as Uint8Array).set(bins);
    texture.needsUpdate = true;

    const objetivo = source === "mic" ? p.mic : p.voice;
    nivel.current += (objetivo - nivel.current) * Math.min(1, delta * 8);

    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uOpacity.value = 0.12 + nivel.current * 2.2;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={material}>
      <ringGeometry args={[radius, radius + 0.55, 180, 1]} />
    </mesh>
  );
}
