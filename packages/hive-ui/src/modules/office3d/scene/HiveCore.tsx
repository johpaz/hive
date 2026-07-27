import { useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, Group, MathUtils, Mesh, PointLight } from "three";
import type { GraphNode } from "@/stores/canvasStore";
import { useOffice3DStore } from "../state/office3dStore";
import { CORE_POSITION } from "./swarm";
import type { SwarmRef } from "./swarm";

const CORE_COLOR = "#f59e0b"; // ámbar Hive

export function HiveCore({
  coordinator,
  active,
  swarmRef,
}: {
  coordinator: GraphNode | null;
  active: boolean;
  swarmRef: SwarmRef;
}) {
  const groupRef = useRef<Group>(null);
  const wingLeftRef = useRef<Group>(null);
  const wingRightRef = useRef<Group>(null);
  const lightRef = useRef<PointLight>(null);
  const crownRef = useRef<Group>(null);
  const antennaRef = useRef<Group>(null);
  const selected = useOffice3DStore((s) => !!coordinator && s.selectedAgentId === coordinator.id);
  const select = useOffice3DStore((s) => s.select);
  const motion = useOffice3DStore((s) => s.motion);
  const activeCue = useOffice3DStore((s) => s.activeCue);
  const processing = coordinator?.status === "thinking" || coordinator?.status === "tool_call";

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const coordinatorInvolved =
      !!coordinator &&
      (activeCue?.actorId === coordinator.id || activeCue?.targetId === coordinator.id);
    const otherId =
      activeCue?.actorId === coordinator?.id ? activeCue.targetId : activeCue?.actorId;
    const other = otherId ? swarmRef.current.get(otherId)?.pos : null;
    if (groupRef.current) {
      const breathe = motion === "calm" && (active || processing) ? Math.sin(t * 2.1) * 0.04 : 0;
      groupRef.current.position.y = 1.05 + breathe;
      const idleYaw = motion === "calm" ? Math.sin(t * 0.38) * 0.08 : 0;
      const targetYaw = coordinatorInvolved && other ? Math.atan2(other.x, other.z) : idleYaw;
      groupRef.current.rotation.y = MathUtils.damp(groupRef.current.rotation.y, targetYaw, 4.5, delta);
      const targetScale = coordinatorInvolved && motion === "calm" ? 1.08 : 1;
      const scale = MathUtils.damp(groupRef.current.scale.x, targetScale, 5, delta);
      groupRef.current.scale.setScalar(scale);
    }
    const flap = motion === "calm"
      ? Math.sin(t * (coordinatorInvolved ? 7 : active || processing ? 4.2 : 1.4)) *
        (coordinatorInvolved ? 0.34 : active || processing ? 0.24 : 0.08)
      : 0;
    if (wingLeftRef.current) {
      wingLeftRef.current.rotation.z = 0.28 + flap;
    }
    if (wingRightRef.current) {
      wingRightRef.current.rotation.z = -0.28 - flap;
    }
    if (lightRef.current) {
      lightRef.current.intensity += ((active || processing ? 12 : 6) - lightRef.current.intensity) * 0.04;
    }
    if (crownRef.current) {
      crownRef.current.rotation.y += delta * (coordinatorInvolved ? 1.2 : 0.22);
    }
    if (antennaRef.current) {
      antennaRef.current.rotation.z =
        coordinatorInvolved && motion === "calm" ? Math.sin(t * 7) * 0.08 : 0;
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (coordinator) select(selected ? null : coordinator.id);
  };

  return (
    <group position={CORE_POSITION}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[2.5, 2.8, 0.45, 6]} />
        <meshStandardMaterial
          color="#0b0f1a"
          metalness={0.7}
          roughness={0.35}
          emissive={CORE_COLOR}
          emissiveIntensity={selected ? 0.5 : 0.18}
        />
      </mesh>
      <mesh position={[0, 0.54, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.85, 2.22, 6]} />
        <meshBasicMaterial color={CORE_COLOR} transparent opacity={selected ? 0.9 : 0.48} blending={AdditiveBlending} />
      </mesh>

      {/* Reina procedural: misma familia visual que los agentes, pero inequívocamente líder. */}
      <group
        ref={groupRef}
        onClick={handleClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        {/* Abdomen largo de reina */}
        <mesh position={[0, 1.2, 0]} scale={[0.74, 1.28, 0.68]}>
          <sphereGeometry args={[0.72, 24, 20]} />
          <meshStandardMaterial
            color="#e6a519"
            emissive={CORE_COLOR}
            emissiveIntensity={selected ? 0.8 : 0.42}
            metalness={0.34}
            roughness={0.36}
          />
        </mesh>
        {[0.58, 1.02, 1.46].map((y, index) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5 - index * 0.035, 0.075, 8, 28]} />
            <meshStandardMaterial color="#251807" metalness={0.52} roughness={0.48} />
          </mesh>
        ))}
        <mesh position={[0, -0.02, 0]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.14, 0.52, 8]} />
          <meshStandardMaterial color="#ffcf6a" emissive={CORE_COLOR} emissiveIntensity={0.5} />
        </mesh>

        {/* Tórax y cabeza */}
        <mesh position={[0, 2.25, 0]} scale={[1, 0.9, 0.82]}>
          <sphereGeometry args={[0.7, 22, 18]} />
          <meshStandardMaterial
            color="#593c12"
            emissive={CORE_COLOR}
            emissiveIntensity={selected ? 0.55 : 0.24}
            metalness={0.48}
            roughness={0.42}
          />
        </mesh>
        <mesh position={[0, 3.15, 0]}>
          <sphereGeometry args={[0.54, 22, 18]} />
          <meshStandardMaterial
            color="#d69113"
            emissive={CORE_COLOR}
            emissiveIntensity={selected ? 0.95 : 0.48}
            metalness={0.38}
            roughness={0.34}
          />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.34, 3.2, 0.4]} scale={[1, 1.18, 0.42]}>
            <sphereGeometry args={[0.15, 12, 10]} />
            <meshBasicMaterial color="#fff1a8" />
          </mesh>
        ))}

        <group ref={antennaRef} position={[0, 3.55, 0]}>
          {[-1, 1].map((side) => (
            <group key={side} rotation={[0, 0, side * -0.36]}>
              <mesh position={[side * 0.22, 0.28, 0]}>
                <capsuleGeometry args={[0.035, 0.42, 4, 8]} />
                <meshBasicMaterial color="#ffd465" />
              </mesh>
              <mesh position={[side * 0.32, 0.53, 0]}>
                <sphereGeometry args={[0.07, 8, 8]} />
                <meshBasicMaterial color="#fff0a6" />
              </mesh>
            </group>
          ))}
        </group>

        {/* Dos pares de alas: más grandes que las de cualquier worker */}
        <group ref={wingLeftRef} position={[0.48, 2.45, 0]}>
          <mesh position={[0.62, 0.18, 0]} rotation={[0.08, 0.15, -0.18]} scale={[1.65, 0.12, 0.72]}>
            <sphereGeometry args={[0.48, 16, 12]} />
            <meshStandardMaterial color="#e8f8ff" emissive="#8cdcff" emissiveIntensity={0.58} transparent opacity={0.48} side={DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[0.46, -0.34, 0.05]} rotation={[0.08, 0.1, 0.2]} scale={[1.25, 0.1, 0.58]}>
            <sphereGeometry args={[0.4, 14, 10]} />
            <meshStandardMaterial color="#dff7ff" emissive="#77c8ff" emissiveIntensity={0.42} transparent opacity={0.38} side={DoubleSide} depthWrite={false} />
          </mesh>
        </group>
        <group ref={wingRightRef} position={[-0.48, 2.45, 0]}>
          <mesh position={[-0.62, 0.18, 0]} rotation={[0.08, -0.15, 0.18]} scale={[1.65, 0.12, 0.72]}>
            <sphereGeometry args={[0.48, 16, 12]} />
            <meshStandardMaterial color="#e8f8ff" emissive="#8cdcff" emissiveIntensity={0.58} transparent opacity={0.48} side={DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[-0.46, -0.34, 0.05]} rotation={[0.08, -0.1, -0.2]} scale={[1.25, 0.1, 0.58]}>
            <sphereGeometry args={[0.4, 14, 10]} />
            <meshStandardMaterial color="#dff7ff" emissive="#77c8ff" emissiveIntensity={0.42} transparent opacity={0.38} side={DoubleSide} depthWrite={false} />
          </mesh>
        </group>

        {/* Corona hexagonal flotante, emblema de coordinador */}
        <group ref={crownRef} position={[0, 4.08, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.48, 0.055, 6, 6]} />
            <meshBasicMaterial color="#ffe38a" blending={AdditiveBlending} />
          </mesh>
          {[-0.4, 0, 0.4].map((x, index) => (
            <mesh key={x} position={[x, index === 1 ? 0.25 : 0.14, 0]}>
              <coneGeometry args={[0.11, index === 1 ? 0.48 : 0.34, 5]} />
              <meshStandardMaterial color="#ffd465" emissive={CORE_COLOR} emissiveIntensity={0.9} metalness={0.6} roughness={0.2} />
            </mesh>
          ))}
        </group>
      </group>

      <pointLight ref={lightRef} position={[0, 3, 0]} color={CORE_COLOR} intensity={6} distance={18} decay={1.8} />

    </group>
  );
}
