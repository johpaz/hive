import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Mesh, Vector3 } from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import type { SwarmRef } from "./swarm";

const CORE_TARGET = new Vector3(0, 4.4, 0);
const FLIGHT_SECONDS = 1.1;
const RETURN_COLOR = "#f59e0b"; // ámbar: la miel vuelve a la colmena

interface Packet {
  id: number;
  from: Vector3;
}

let packetSeq = 0;

/**
 * Retorno del loop: cuando un worker termina su tarea (currentTask → null),
 * un paquete de luz vuela de la abeja de vuelta al núcleo — la entrega
 * verificada regresa al coordinador.
 */
export function ReturnPackets({ desks, swarmRef }: { desks: DeskModel[]; swarmRef: SwarmRef }) {
  const [packets, setPackets] = useState<Packet[]>([]);
  const prevTasks = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    const prev = prevTasks.current;
    for (const desk of desks) {
      const before = prev.get(desk.agent.id) ?? null;
      if (before && !desk.currentTask) {
        const bee = swarmRef.current.get(desk.agent.id);
        if (bee) {
          const id = ++packetSeq;
          setPackets((p) => [...p, { id, from: bee.pos.clone() }]);
        }
      }
      prev.set(desk.agent.id, desk.currentTask);
    }
  }, [desks, swarmRef]);

  return (
    <group>
      {packets.map((p) => (
        <PacketOrb
          key={p.id}
          packet={p}
          onDone={() => setPackets((ps) => ps.filter((x) => x.id !== p.id))}
        />
      ))}
    </group>
  );
}

function PacketOrb({ packet, onDone }: { packet: Packet; onDone: () => void }) {
  const meshRef = useRef<Mesh>(null);
  const t = useRef(0);
  const done = useRef(false);

  useFrame((_, delta) => {
    if (done.current || !meshRef.current) return;
    t.current = Math.min(1, t.current + delta / FLIGHT_SECONDS);
    const k = t.current * t.current; // ease-in: sale lento, llega rápido
    meshRef.current.position.lerpVectors(packet.from, CORE_TARGET, k);
    meshRef.current.position.y += Math.sin(k * Math.PI) * 1.6; // arco
    const s = 1 - k * 0.5;
    meshRef.current.scale.setScalar(s);
    if (t.current >= 1) {
      done.current = true;
      onDone();
    }
  });

  return (
    <mesh ref={meshRef} position={packet.from}>
      <sphereGeometry args={[0.17, 10, 10]} />
      <meshBasicMaterial color={RETURN_COLOR} transparent opacity={0.95} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}
