import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, ShaderMaterial, Vector4 } from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { hexFloorVertex, hexFloorFragment, MAX_FLOOR_PULSES } from "../shaders/hexFloor.glsl";
import type { SwarmRef } from "./swarm";

export interface FloorPulse {
  x: number;
  z: number;
  intensity: number;
}

export function HexFloor({ desks, swarmRef }: { desks: DeskModel[]; swarmRef: SwarmRef }) {
  const materialRef = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color("#4f8ff7") },
      uPulses: {
        value: Array.from({ length: MAX_FLOOR_PULSES }, () => new Vector4(0, 0, 0, 0)),
      },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const arr = uniforms.uPulses.value as Vector4[];
    const active = desks
      .filter((desk) => desk.state === "thinking" || desk.state === "tool_call" || desk.state === "stuck")
      .slice(0, MAX_FLOOR_PULSES);
    for (let i = 0; i < MAX_FLOOR_PULSES; i++) {
      const desk = active[i];
      const bee = desk ? swarmRef.current.get(desk.agent.id) : null;
      if (desk && bee) arr[i].set(bee.pos.x, bee.pos.z, i * 0.13, desk.state === "tool_call" ? 1 : 0.6);
      else arr[i].set(0, 0, 0, 0);
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <circleGeometry args={[48, 72]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={hexFloorVertex}
        fragmentShader={hexFloorFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}
