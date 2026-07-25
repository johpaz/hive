import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { beamVertex, beamFragment } from "../shaders/beam.glsl";
import type { SwarmRef } from "./swarm";

interface BeamsProps {
  desks: DeskModel[];
  swarmRef: SwarmRef;
  coordinatorId: string | null;
}

const CORE_BEAM_ORIGIN = new Vector3(0, 4.4, 0);
const _from = new Vector3();
const _to = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const _quat = new Quaternion();

/**
 * Eslabones del loop: un beam por delegación activa.
 * Origen resuelto por `delegatedBy`: coordinador → núcleo; otro agente
 * (p. ej. el verificador) → posición viva de esa abeja.
 */
export function DelegationBeams({ desks, swarmRef, coordinatorId }: BeamsProps) {
  const active = desks.filter((d) => d.currentTask || d.state === "tool_call");

  return (
    <group>
      {active.map((d) => (
        <Beam key={d.agent.id} desk={d} swarmRef={swarmRef} coordinatorId={coordinatorId} />
      ))}
    </group>
  );
}

function Beam({
  desk,
  swarmRef,
  coordinatorId,
}: {
  desk: DeskModel;
  swarmRef: SwarmRef;
  coordinatorId: string | null;
}) {
  const meshRef = useRef<Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color(desk.color) },
      uSpeed: { value: 0.9 },
      uIntensity: { value: 1.15 },
    }),
    [desk.color],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;

    const target = swarmRef.current.get(desk.agent.id);
    if (!target || !meshRef.current) return;

    const fromCoordinator = !desk.delegatedBy || desk.delegatedBy === coordinatorId;
    if (fromCoordinator) {
      _from.copy(CORE_BEAM_ORIGIN);
    } else {
      const src = swarmRef.current.get(desk.delegatedBy as string);
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
    meshRef.current.position.lerpVectors(_from, _to, 0.5);
    _quat.setFromUnitVectors(_up, _dir.normalize());
    meshRef.current.quaternion.copy(_quat);
    meshRef.current.scale.set(0.085, len, 0.085);
  });

  return (
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
  );
}
