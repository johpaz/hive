import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, QuadraticBezierLine } from "@react-three/drei";
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, Vector3 } from "three";
import type { CanvasJevDecision, JevStatus } from "@/stores/canvasStore";
import { JEV_COLOR, JEV_FALLBACK_COLOR, jevKindLabel, jevSavingChip } from "../state/jev";
import type { SwarmRef } from "./swarm";

/** Encima de la corona de la reina: asesora a todo el enjambre sin ser una abeja más. */
export const JEV_ORACLE_POSITION = new Vector3(0, 7.6, 0);
const COORDINATOR_POINT = new Vector3(0, 4.4, 0);
const BEAM_SECONDS = 1.7;
const MAX_BEAMS = 6;

type Line2Like = {
  setPoints: (start: Vector3, end: Vector3, mid: Vector3) => void;
  material: { opacity: number };
};

interface Beam {
  decision: CanvasJevDecision;
  chip: string | null;
}

export function JevOracle({
  status,
  decisions,
  swarmRef,
  coordinatorId,
  motion,
}: {
  status: JevStatus | null;
  decisions: CanvasJevDecision[];
  swarmRef: SwarmRef;
  coordinatorId: string | null;
  motion: "calm" | "off";
}) {
  const shellRef = useRef<Mesh>(null);
  const coreRef = useRef<Mesh>(null);
  const ringRef = useRef<Group>(null);
  const lightRef = useRef<PointLight>(null);
  const pulse = useRef(0);
  const [beams, setBeams] = useState<Beam[]>([]);
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);

  useEffect(() => {
    // Decisions that happened before the page opened are history, not motion.
    if (!initialized.current) {
      decisions.forEach((d) => seen.current.add(d.eventId));
      initialized.current = true;
      return;
    }
    const fresh = decisions.filter((d) => !seen.current.has(d.eventId));
    if (fresh.length === 0) return;
    fresh.forEach((d) => seen.current.add(d.eventId));
    pulse.current = 1;
    if (motion === "off") return;
    setBeams((active) => [
      ...active,
      ...fresh.map((decision) => ({ decision, chip: jevSavingChip(decision.savedTokens) })),
    ].slice(-MAX_BEAMS));
  }, [decisions, motion]);

  const fallback = status?.state === "fallback";
  const color = fallback ? JEV_FALLBACK_COLOR : JEV_COLOR;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    pulse.current = Math.max(0, pulse.current - delta * 1.4);
    const spin = motion === "calm" ? (fallback ? 0.12 : 0.35) + pulse.current * 2.2 : 0;
    if (shellRef.current) {
      shellRef.current.rotation.y += delta * spin;
      shellRef.current.rotation.x += delta * spin * 0.4;
      shellRef.current.scale.setScalar(1 + pulse.current * 0.22);
    }
    if (coreRef.current) {
      const material = coreRef.current.material as MeshStandardMaterial;
      // A fallback flickers faintly: present, but not the one deciding.
      const idleGlow = fallback ? 0.25 + Math.max(0, Math.sin(t * 9)) * 0.15 : 0.7 + Math.sin(t * 1.6) * 0.12;
      material.emissiveIntensity = idleGlow + pulse.current * 1.6;
      coreRef.current.rotation.y -= delta * spin * 0.6;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (motion === "calm" ? 0.5 + pulse.current * 3 : 0);
    }
    if (lightRef.current) {
      lightRef.current.intensity = (fallback ? 1.2 : 3) + pulse.current * 9;
    }
  });

  if (!status || status.state === "off") return null;

  return (
    <group>
      <group position={JEV_ORACLE_POSITION}>
        {/* Cristal exterior: el plano de decisión, facetado y transparente. */}
        <mesh ref={shellRef}>
          <icosahedronGeometry args={[0.95, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={coreRef}>
          <octahedronGeometry args={[0.45, 0]} />
          <meshStandardMaterial color="#1e1535" emissive={color} emissiveIntensity={0.7} metalness={0.4} roughness={0.25} />
        </mesh>
        <group ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <torusGeometry args={[1.45, 0.025, 6, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
        <pointLight ref={lightRef} color={color} intensity={3} distance={12} decay={1.8} />
        <Html position={[0, 1.55, 0]} center distanceFactor={22} className="pointer-events-none select-none">
          <div className={`office3d-jev-tag ${fallback ? "is-fallback" : ""}`}>JEV</div>
        </Html>
      </group>

      {beams.map((beam) => (
        <JevBeam
          key={beam.decision.eventId}
          beam={beam}
          swarmRef={swarmRef}
          coordinatorId={coordinatorId}
          color={color}
          onDone={() => setBeams((active) => active.filter((b) => b.decision.eventId !== beam.decision.eventId))}
        />
      ))}
    </group>
  );
}

function JevBeam({
  beam,
  swarmRef,
  coordinatorId,
  color,
  onDone,
}: {
  beam: Beam;
  swarmRef: SwarmRef;
  coordinatorId: string | null;
  color: string;
  onDone: () => void;
}) {
  const lineRef = useRef<Line2Like | null>(null);
  const sparkRef = useRef<Mesh>(null);
  const labelRef = useRef<Group>(null);
  const elapsed = useRef(0);
  const done = useRef(false);
  const end = useRef(new Vector3());
  const mid = useRef(new Vector3());
  const { decision, chip } = beam;

  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const target =
      decision.agentId === coordinatorId ? COORDINATOR_POINT : swarmRef.current.get(decision.agentId)?.pos;
    if (target) end.current.copy(target);
    else end.current.copy(COORDINATOR_POINT);
    mid.current.lerpVectors(JEV_ORACLE_POSITION, end.current, 0.5);
    mid.current.y += 2.4;

    const progress = Math.min(1, elapsed.current / BEAM_SECONDS);
    // Rises fast, lingers, then fades: the eye catches the target, not the travel.
    const opacity = progress < 0.2 ? progress / 0.2 : 1 - Math.max(0, (progress - 0.55) / 0.45);
    if (lineRef.current) {
      lineRef.current.setPoints(JEV_ORACLE_POSITION, end.current, mid.current);
      lineRef.current.material.opacity = opacity * 0.85;
    }
    if (sparkRef.current) {
      const s = Math.min(1, progress / 0.45);
      const a = 1 - s;
      // Point on the quadratic Bézier at s.
      sparkRef.current.position.set(
        a * a * JEV_ORACLE_POSITION.x + 2 * a * s * mid.current.x + s * s * end.current.x,
        a * a * JEV_ORACLE_POSITION.y + 2 * a * s * mid.current.y + s * s * end.current.y,
        a * a * JEV_ORACLE_POSITION.z + 2 * a * s * mid.current.z + s * s * end.current.z,
      );
      (sparkRef.current.material as MeshBasicMaterial).opacity = opacity;
    }
    labelRef.current?.position.copy(end.current);
    if (progress >= 1) {
      done.current = true;
      onDone();
    }
  });

  return (
    <group>
      <QuadraticBezierLine
        ref={lineRef as never}
        start={JEV_ORACLE_POSITION}
        end={COORDINATOR_POINT}
        color={color}
        lineWidth={1.6}
        transparent
        opacity={0}
        depthWrite={false}
      />
      <mesh ref={sparkRef}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <group ref={labelRef}>
        <Html position={[0, 1.35, 0]} center distanceFactor={20} className="pointer-events-none select-none">
          <div className="office3d-jev-chip">
            <span>Jev · {jevKindLabel(decision.kind)}</span>
            {chip && <strong className={decision.savedTokens < 0 ? "is-cost" : ""}>{chip}</strong>}
            <small>{decision.latencyMs} ms</small>
          </div>
        </Html>
      </group>
    </group>
  );
}
