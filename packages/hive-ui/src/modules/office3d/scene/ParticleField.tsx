import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial } from "three";
import { pointsVertex, pointsFragment } from "../shaders/particles.glsl";

const COUNT = 780;
const RADIUS = 42;
const HEIGHT = 22;

/** Polvo de datos ambiental: derive + ascenso envolvente en el vertex shader. */
export function ParticleField() {
  const materialRef = useRef<ShaderMaterial>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const r = Math.sqrt(Math.random()) * RADIUS;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * HEIGHT;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = Math.random();
    }
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color("#6aa9ff") },
      uOpacity: { value: 0.16 },
      uPixelRatio: { value: dpr },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uPixelRatio.value = state.viewport.dpr;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={pointsVertex}
        fragmentShader={pointsFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
