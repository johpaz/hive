/**
 * Telón de panal.
 *
 * Sustituye al suelo hexagonal de la Oficina 3D, que es azul y está pensado para
 * una cámara cenital a 60 unidades: en un primer plano quedaba a contrapelo de
 * la paleta dorada de BIA y competía con ella. Este es un muro frontal, del
 * mismo oro apagado que el fondo del render, y vive detrás del avatar.
 *
 * La celda que se ilumina no es decorativa: la actividad sube cuando la colmena
 * está trabajando, así que el fondo respira al ritmo de lo que pasa por dentro.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uWork;
  uniform float uEnergy;
  uniform vec3  uColor;
  uniform vec3  uAccent;

  varying vec2 vUv;

  const vec2 S = vec2(1.0, 1.7320508);

  vec3 hash3(vec2 p) {
    vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
    return fract(sin(q) * 43758.5453);
  }

  /** xy = posición en la celda, zw = identificador de la celda. */
  vec4 hexCell(vec2 p) {
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / S.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * S, p - (hC.zw + 0.5) * S);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
  }

  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, S * 0.5), p.x);
  }

  void main() {
    // Aspecto corregido para que las celdas no salgan estiradas.
    vec2 uv = (vUv - 0.5) * vec2(9.0, 13.5);

    vec4 cell = hexCell(uv);
    float d = hexDist(cell.xy);

    // Trazo fino: el panal insinuado, nunca protagonista.
    float linea = smoothstep(0.50, 0.47, d) * smoothstep(0.40, 0.47, d);

    // Latido por celda, cada una con su fase. Sin trabajo en curso apenas se
    // adivina; con la colmena activa recorre el muro.
    vec3 semilla = hash3(cell.zw);
    float fase = semilla.x * 6.283;
    float pulso = 0.5 + 0.5 * sin(uTime * (0.5 + semilla.y * 0.8) + fase);
    float viva = smoothstep(0.55, 1.0, pulso) * (0.10 + uWork * 0.9);

    // Relleno tenue sólo en las celdas encendidas.
    float relleno = smoothstep(0.46, 0.0, d) * viva * 0.35;

    vec3 color = uColor * linea * (0.22 + viva * 0.9);
    color += uAccent * relleno;
    color += uAccent * linea * uEnergy * 0.35;

    // Desvanecido radial: el muro se pierde en la oscuridad en vez de cortarse.
    vec2 c = (vUv - 0.5) * vec2(2.0, 1.7);
    float borde = 1.0 - smoothstep(0.35, 1.0, length(c));

    gl_FragColor = vec4(color, borde * (0.5 + uWork * 0.35));
  }
`;

interface HexBackdropProps {
  working: boolean;
  /** Energía de la conversación: ilumina el panal cuando alguien habla. */
  energyRef: { current: number };
  accent?: string;
}

export function HexBackdrop({ working, energyRef, accent = "#ffb43a" }: HexBackdropProps) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uWork: { value: 0 },
          uEnergy: { value: 0 },
          uColor: { value: new Color("#8a6a2b") },
          uAccent: { value: new Color(accent) },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [accent],
  );

  const work = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    work.current += ((working ? 1 : 0) - work.current) * dt * 2;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uWork.value = work.current;
    material.uniforms.uEnergy.value = energyRef.current;
  });

  return (
    <mesh position={[0, 0.4, -3.2]} material={material}>
      <planeGeometry args={[16, 11]} />
    </mesh>
  );
}
