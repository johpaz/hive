import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Group } from "three";
import { toolVisualCategory } from "../state/toolVisuals";

function HologramMaterial({ color }: { color: string }) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={0.72}
      wireframe
      blending={AdditiveBlending}
      depthWrite={false}
    />
  );
}

export function ToolHologram({ toolName, color }: { toolName: string | null; color: string }) {
  const groupRef = useRef<Group>(null);
  const category = toolVisualCategory(toolName);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.85;
    groupRef.current.position.y = 1.05 + Math.sin(state.clock.elapsedTime * 2.4) * 0.08;
  });

  return (
    <group ref={groupRef} scale={0.7}>
      {category === "browser" && (
        <>
          <mesh><sphereGeometry args={[0.42, 10, 8]} /><HologramMaterial color={color} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.53, 0.035, 6, 24]} /><HologramMaterial color={color} /></mesh>
        </>
      )}
      {category === "code" && (
        <>
          <mesh><boxGeometry args={[0.75, 0.55, 0.12]} /><HologramMaterial color={color} /></mesh>
          <mesh position={[-0.16, 0, 0.1]} rotation={[0, 0, -0.55]}><boxGeometry args={[0.06, 0.32, 0.05]} /><HologramMaterial color={color} /></mesh>
          <mesh position={[0.16, 0, 0.1]} rotation={[0, 0, 0.55]}><boxGeometry args={[0.06, 0.32, 0.05]} /><HologramMaterial color={color} /></mesh>
        </>
      )}
      {category === "knowledge" && (
        <>
          <mesh><octahedronGeometry args={[0.46, 0]} /><HologramMaterial color={color} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.58, 0.025, 6, 6]} /><HologramMaterial color={color} /></mesh>
        </>
      )}
      {category === "communication" && (
        <>
          {[0.25, 0.42, 0.59].map((radius) => (
            <mesh key={radius} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[radius, 0.025, 5, 20, Math.PI]} /><HologramMaterial color={color} /></mesh>
          ))}
        </>
      )}
      {category === "generic" && (
        <>
          <mesh><icosahedronGeometry args={[0.4, 0]} /><HologramMaterial color={color} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.56, 0.025, 5, 24]} /><HologramMaterial color={color} /></mesh>
        </>
      )}
      <pointLight color={color} intensity={2.2} distance={4} decay={2} />
    </group>
  );
}
