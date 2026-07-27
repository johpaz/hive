import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import type { DeskModel, OfficeInteraction } from "@/modules/office3d/state/useOfficeModel";
import { beamVertex, beamFragment } from "../shaders/beam.glsl";
import type { SwarmRef } from "./swarm";

interface BeamsProps {
  desks: DeskModel[];
  interactions: OfficeInteraction[];
  swarmRef: SwarmRef;
  coordinatorId: string | null;
}

const CORE_BEAM_ORIGIN = new Vector3(0, 4.4, 0);
const _from = new Vector3();
const _to = new Vector3();
const _dir = new Vector3();
const _midpoint = new Vector3();
const _up = new Vector3(0, 1, 0);
const _quat = new Quaternion();

/**
 * Eslabones del loop: un beam por delegación activa.
 * Origen resuelto por `delegatedBy`: coordinador → núcleo; otro agente
 * (p. ej. el verificador) → posición viva de esa abeja.
 */
export function DelegationBeams({ desks, interactions, swarmRef, coordinatorId }: BeamsProps) {
  return (
    <group>
      {interactions.map((interaction) => (
        <Beam
          key={interaction.id}
          interaction={interaction}
          targetDesk={desks.find((desk) => desk.agent.id === interaction.targetId) ?? null}
          swarmRef={swarmRef}
          coordinatorId={coordinatorId}
        />
      ))}
    </group>
  );
}

function Beam({
  interaction,
  targetDesk,
  swarmRef,
  coordinatorId,
}: {
  interaction: OfficeInteraction;
  targetDesk: DeskModel | null;
  swarmRef: SwarmRef;
  coordinatorId: string | null;
}) {
  const meshRef = useRef<Mesh>(null);
  const labelRef = useRef<Group>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color(targetDesk?.color ?? "#f59e0b") },
      uSpeed: { value: 0.52 },
      uIntensity: { value: 0.82 },
    }),
    [targetDesk?.color],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;

    const target = swarmRef.current.get(interaction.targetId);
    if (!target || !meshRef.current) return;

    const fromCoordinator = interaction.sourceId === coordinatorId;
    if (fromCoordinator) {
      _from.copy(CORE_BEAM_ORIGIN);
    } else {
      const src = swarmRef.current.get(interaction.sourceId);
      if (!src) {
        meshRef.current.visible = false;
        return;
      }
      _from.copy(src.pos);
    }
    _to.copy(target.pos);

    _dir.subVectors(_to, _from);
    const len = _dir.length();
    meshRef.current.visible = len > 0.5;
    if (len <= 0.5) return;

    // Cilindro unitario estirado entre los dos puntos (O(1) por frame)
    _midpoint.addVectors(_from, _to).multiplyScalar(0.5);
    meshRef.current.position.copy(_midpoint);
    labelRef.current?.position.copy(_midpoint);
    _quat.setFromUnitVectors(_up, _dir.normalize());
    meshRef.current.quaternion.copy(_quat);
    meshRef.current.scale.set(0.055, len, 0.055);

  });

  return (
    <group>
      <mesh ref={meshRef} visible={false}>
        <cylinderGeometry args={[1, 1, 1, 6, 1, true]} />
        <shaderMaterial
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>
      <group ref={labelRef}>
        <Html position={[0, 0.55, 0]} center distanceFactor={24} className="pointer-events-none select-none">
          <div className="office3d-beam-label" style={{ ["--chip-color" as string]: targetDesk?.color ?? "#f59e0b" }}>
            <strong>{interaction.kind === "reviews" ? "REVISIÓN EN CURSO" : "TRABAJO DELEGADO"}</strong>
            {interaction.taskName && <span>{interaction.taskName}</span>}
          </div>
        </Html>
      </group>
    </group>
  );
}
