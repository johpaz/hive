import { useMemo } from "react";
import { AdditiveBlending, Color } from "three";
import { hexFloorVertex, hexFloorFragment } from "../shaders/hexFloor.glsl";

export function HexFloor() {
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Color("#4f8ff7") },
    }),
    [],
  );

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <circleGeometry args={[48, 72]} />
      <shaderMaterial
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
