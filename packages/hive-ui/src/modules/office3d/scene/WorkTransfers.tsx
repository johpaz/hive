import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, Group, Mesh, Vector3 } from "three";
import type { CanvasWorkEvent } from "@/stores/canvasStore";
import type { DeskModel } from "../state/useOfficeModel";
import { workPhaseLabel, workPhaseTone } from "../state/presentation";
import type { SwarmRef } from "./swarm";

const CORE_TRANSFER_POINT = new Vector3(0, 4.4, 0);
const TRANSFER_SECONDS = 2.25;

interface Transfer {
  id: number;
  event: CanvasWorkEvent;
  startId: string;
  endId: string;
  sourceName: string;
  targetName: string;
  color: string;
}

let transferSequence = 0;

function transferColor(event: CanvasWorkEvent, deskColor: string | undefined): string {
  const tone = workPhaseTone(event.phase);
  if (tone === "alert") return "#fb7185";
  if (tone === "done") return "#86efac";
  if (tone === "review") return "#67e8f9";
  return deskColor ?? "#f59e0b";
}

export function WorkTransfers({
  desks,
  events,
  swarmRef,
  coordinatorId,
  coordinatorName,
}: {
  desks: DeskModel[];
  events: CanvasWorkEvent[];
  swarmRef: SwarmRef;
  coordinatorId: string | null;
  coordinatorName: string;
}) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      events.forEach((event) => seen.current.add(event.eventId));
      initialized.current = true;
      return;
    }

    const byId = new Map(desks.map((desk) => [desk.agent.id, desk]));
    const nameOf = (id: string) =>
      id === coordinatorId ? coordinatorName : byId.get(id)?.agent.name ?? "Agente";
    const created: Transfer[] = [];

    for (const event of events) {
      if (seen.current.has(event.eventId)) continue;
      seen.current.add(event.eventId);
      const endId = event.targetId || coordinatorId;
      if (!endId) continue;
      created.push({
        id: ++transferSequence,
        event,
        startId: event.actorId,
        endId,
        sourceName: nameOf(event.actorId),
        targetName: nameOf(endId),
        color: transferColor(event, byId.get(endId)?.color ?? byId.get(event.actorId)?.color),
      });
    }

    if (created.length > 0) {
      setTransfers((active) => [...active, ...created].slice(-8));
    }
  }, [coordinatorId, coordinatorName, desks, events]);

  return (
    <group>
      {transfers.map((transfer) => (
        <TransferFlight
          key={transfer.id}
          transfer={transfer}
          swarmRef={swarmRef}
          coordinatorId={coordinatorId}
          onDone={() =>
            setTransfers((active) => active.filter((item) => item.id !== transfer.id))
          }
        />
      ))}
    </group>
  );
}

function TransferFlight({
  transfer,
  swarmRef,
  coordinatorId,
  onDone,
}: {
  transfer: Transfer;
  swarmRef: SwarmRef;
  coordinatorId: string | null;
  onDone: () => void;
}) {
  const packetRef = useRef<Mesh>(null);
  const pulseRef = useRef<Group>(null);
  const labelRef = useRef<Group>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const from = useRef(new Vector3());
  const to = useRef(new Vector3());

  useFrame((_, delta) => {
    if (finished.current || !packetRef.current) return;
    elapsed.current = Math.min(TRANSFER_SECONDS, elapsed.current + delta);
    const start =
      transfer.startId === coordinatorId
        ? CORE_TRANSFER_POINT
        : swarmRef.current.get(transfer.startId)?.pos;
    const end =
      transfer.endId === coordinatorId
        ? CORE_TRANSFER_POINT
        : swarmRef.current.get(transfer.endId)?.pos;

    if (!start || !end) {
      packetRef.current.visible = false;
      if (elapsed.current >= TRANSFER_SECONDS) {
        finished.current = true;
        onDone();
      }
      return;
    }

    packetRef.current.visible = true;
    from.current.copy(start);
    to.current.copy(end);
    const progress = elapsed.current / TRANSFER_SECONDS;
    const flight = Math.min(1, Math.max(0, (progress - 0.14) / 0.86));
    const eased = 1 - Math.pow(1 - flight, 3);

    packetRef.current.position.lerpVectors(from.current, to.current, eased);
    packetRef.current.position.y += Math.sin(eased * Math.PI) * 2.2;
    packetRef.current.rotation.x += delta * 2.4;
    packetRef.current.rotation.y += delta * 3.2;
    labelRef.current?.position.copy(packetRef.current.position);

    if (pulseRef.current) {
      pulseRef.current.position.copy(from.current);
      pulseRef.current.visible = progress < 0.46;
      const pulse = 0.8 + ((progress * 5.2) % 1) * 1.35;
      pulseRef.current.scale.setScalar(pulse);
      pulseRef.current.rotation.y += delta * 0.8;
    }

    if (elapsed.current >= TRANSFER_SECONDS) {
      finished.current = true;
      onDone();
    }
  });

  const headline =
    transfer.event.phase === "delegated"
      ? `${transfer.sourceName} llama a ${transfer.targetName}`
      : transfer.event.phase === "completed"
        ? `${transfer.sourceName} entrega a ${transfer.targetName}`
        : transfer.event.phase === "review_started"
          ? `${transfer.sourceName} solicita revisión`
          : `${transfer.sourceName} informa a ${transfer.targetName}`;

  return (
    <group>
      <group ref={pulseRef}>
        {[0.72, 1.08].map((radius, index) => (
          <mesh key={radius} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, index === 0 ? 0.055 : 0.035, 6, 28]} />
            <meshBasicMaterial
              color={transfer.color}
              transparent
              opacity={index === 0 ? 0.72 : 0.42}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
      <mesh ref={packetRef}>
        <octahedronGeometry args={[0.3, 0]} />
        <meshBasicMaterial
          color={transfer.color}
          transparent
          opacity={0.98}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <group ref={labelRef}>
        <Html position={[0, 0.75, 0]} center distanceFactor={20} className="pointer-events-none select-none">
          <div
            className={`office3d-transfer-label is-compact is-${workPhaseTone(transfer.event.phase)}`}
            style={{ ["--chip-color" as string]: transfer.color }}
          >
            <span>{headline}</span>
            <strong>{workPhaseLabel(transfer.event.phase).toUpperCase()}</strong>
          </div>
        </Html>
      </group>
    </group>
  );
}
