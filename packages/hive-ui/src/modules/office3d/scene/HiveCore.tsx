import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, Color, DoubleSide, Group, PointLight, ShaderMaterial } from "three";
import { hologramVertex, hologramFragment } from "../shaders/hologram.glsl";
import { CORE_POSITION } from "./swarm";

const CORE_COLOR = "#f59e0b"; // ámbar Hive

function useHoloMaterial(color: string, opacity: number) {
  return useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: hologramVertex,
        fragmentShader: hologramFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new Color(color) },
          uIntensity: { value: 1.1 },
          uGlitch: { value: 0 },
          uOpacity: { value: opacity },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [color, opacity],
  );
}

export function HiveCore({ active, tasks, status }: { active: boolean; tasks: number; status: string | null }) {
  const groupRef = useRef<Group>(null);
  const prismMat = useHoloMaterial(CORE_COLOR, 0.85);
  const ringMat = useHoloMaterial(CORE_COLOR, 0.6);
  const lightRef = useRef<PointLight>(null);
  const processing = status === "thinking" || status === "tool_call";

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    prismMat.uniforms.uTime.value = t;
    ringMat.uniforms.uTime.value = t;
    const boost = active || processing ? 1.6 : 1.0;
    prismMat.uniforms.uIntensity.value += (1.15 * boost - prismMat.uniforms.uIntensity.value) * 0.05;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * (processing ? 0.6 : 0.25);
      groupRef.current.position.y = 3.3 + Math.sin(t * 0.8) * 0.18;
    }
    if (lightRef.current) {
      lightRef.current.intensity += ((active || processing ? 26 : 14) - lightRef.current.intensity) * 0.04;
    }
  });

  return (
    <group position={CORE_POSITION}>
      {/* Base hexagonal */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[2.7, 3.1, 0.6, 6]} />
        <meshStandardMaterial
          color="#0b0f1a"
          metalness={0.75}
          roughness={0.3}
          emissive={CORE_COLOR}
          emissiveIntensity={0.25}
        />
      </mesh>
      <mesh position={[0, 0.64, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.55, 6]} />
        <meshBasicMaterial color={CORE_COLOR} transparent opacity={0.7} blending={AdditiveBlending} />
      </mesh>

      {/* Núcleo flotante */}
      <group ref={groupRef}>
        <mesh material={prismMat}>
          <cylinderGeometry args={[1.05, 1.05, 2.5, 6]} />
        </mesh>
        <mesh material={ringMat} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.8, 0.035, 8, 48]} />
        </mesh>
        <mesh material={ringMat} rotation={[-Math.PI / 2.6, Math.PI / 5, 0]}>
          <torusGeometry args={[2.25, 0.03, 8, 48]} />
        </mesh>
        <mesh material={ringMat} rotation={[Math.PI / 2, 0, Math.PI / 6]}>
          <torusGeometry args={[2.7, 0.025, 8, 6]} />
        </mesh>
      </group>

      <pointLight ref={lightRef} position={[0, 3.6, 0]} color={CORE_COLOR} intensity={14} distance={26} decay={1.6} />

      <Html position={[0, 7.3, 0]} center distanceFactor={26} className="pointer-events-none select-none">
        <div className="office3d-core-label">
          HIVE&nbsp;CORE
          {tasks > 0 ? (
            <span className="office3d-core-tasks">{tasks} delegada{tasks === 1 ? "" : "s"}</span>
          ) : processing ? (
            <span className="office3d-core-tasks">procesando…</span>
          ) : null}
        </div>
      </Html>
    </group>
  );
}
