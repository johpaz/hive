/**
 * Polen: el polvo dorado que flota alrededor de BIA.
 *
 * Reemplaza al campo de partículas de la Oficina 3D, que en primer plano se veía
 * como discos azules grandes cruzando la pantalla y robaba la atención del
 * rostro. Aquí las motas son diminutas, escasas y lentas: sostienen la
 * atmósfera sin competir con la cara, que es donde tiene que mirarse.
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from "three";

/** Pocas y pequeñas a propósito. Con 800 el fondo se convertía en una nevada. */
const CANTIDAD = 130;

const VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uEnergy;
  varying float vSeed;
  varying float vFade;

  void main() {
    vSeed = aSeed;
    vec3 p = position;

    // Ascenso lento con deriva: polen en el aire, no lluvia.
    float t = uTime * (0.02 + aSeed * 0.05);
    p.y = mod(p.y + t, 6.0) - 3.0;
    p.x += sin(uTime * 0.15 + aSeed * 30.0) * 0.28;
    p.z += cos(uTime * 0.11 + aSeed * 21.0) * 0.22;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // Se desvanecen cerca de los bordes verticales del recorrido.
    vFade = smoothstep(3.0, 1.6, abs(p.y));

    gl_PointSize = (0.8 + aSeed * 1.4) * uPixelRatio * (16.0 / -mv.z) * (1.0 + uEnergy * 0.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uEnergy;
  varying float vSeed;
  varying float vFade;

  void main() {
    // Disco con caída suave: un cuadrado de píxeles se nota muchísimo.
    float d = length(gl_PointCoord - 0.5);
    float disco = smoothstep(0.5, 0.05, d);
    float brillo = 0.25 + vSeed * 0.35 + uEnergy * 0.3;
    gl_FragColor = vec4(uColor * brillo, disco * vFade * 0.5);
  }
`;

interface PollenProps {
  energyRef: { current: number };
  color?: string;
}

export function Pollen({ energyRef, color = "#ffc46b" }: PollenProps) {
  const puntos = useRef<Points>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(CANTIDAD * 3);
    const seeds = new Float32Array(CANTIDAD);
    for (let i = 0; i < CANTIDAD; i++) {
      // Anillo alrededor del avatar: nada de motas cruzándole la cara.
      const ang = Math.random() * Math.PI * 2;
      const radio = 1.9 + Math.random() * 2.6;
      pos[i * 3] = Math.cos(ang) * radio;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 2] = Math.sin(ang) * radio * 0.6 - 0.6;
      seeds[i] = Math.random();
    }
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
          uEnergy: { value: 0 },
          uColor: { value: new Color(color) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [color, dpr],
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uEnergy.value = energyRef.current;
  });

  return <points ref={puntos} geometry={geometry} material={material} frustumCulled={false} />;
}
