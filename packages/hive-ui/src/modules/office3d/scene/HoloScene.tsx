import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";
import { CameraRig } from "./CameraRig";
import { HexFloor } from "./HexFloor";
import { HiveCore } from "./HiveCore";
import { DelegationBeams } from "./DelegationBeams";
import { ParticleField } from "./ParticleField";
import { ActivityBursts } from "./ActivityBursts";
import { Effects } from "./Effects";
import { SwarmDriver } from "./SwarmDriver";
import { LightBee } from "./LightBee";
import { ReturnPackets } from "./ReturnPackets";
import type { BeeState } from "./swarm";

interface HoloSceneProps {
  desks: DeskModel[];
  coordinatorId: string | null;
  coordinatorStatus: string | null;
}

/** Degrada calidad automáticamente si el FPS cae (<38 durante ~3s). */
function QualityGuard() {
  const quality = useOffice3DStore((s) => s.quality);
  const setQuality = useOffice3DStore((s) => s.setQuality);
  const frames = useRef(0);
  const lastCheck = useRef(0);

  useFrame((state) => {
    frames.current += 1;
    const now = state.clock.elapsedTime;
    if (now - lastCheck.current >= 3) {
      const fps = frames.current / (now - lastCheck.current);
      frames.current = 0;
      lastCheck.current = now;
      if (fps < 38 && quality === "high") setQuality("low");
    }
  });
  return null;
}

export function HoloScene({ desks, coordinatorId, coordinatorStatus }: HoloSceneProps) {
  const quality = useOffice3DStore((s) => s.quality);
  const selectedAgentId = useOffice3DStore((s) => s.selectedAgentId);
  const select = useOffice3DStore((s) => s.select);
  const swarmRef = useRef<Map<string, BeeState>>(new Map());
  const anyActive = desks.some((d) => d.state === "thinking" || d.state === "tool_call" || d.state === "stuck");
  const delegatedCount = desks.filter((d) => d.currentTask).length;

  return (
    <Canvas
      dpr={quality === "high" ? [1, 1.75] : 1}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 0.1, far: 220, position: [0, 46, 62] }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#04060c"]} />
      <fog attach="fog" args={["#04060c", 34, 100]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 24, 8]} intensity={0.35} color="#9db8ff" />

      <Suspense fallback={null}>
        <SwarmDriver desks={desks} swarmRef={swarmRef} />
        <CameraRig selectedAgentId={selectedAgentId} swarmRef={swarmRef} />
        <HexFloor desks={desks} swarmRef={swarmRef} />
        <HiveCore active={anyActive} tasks={delegatedCount} status={coordinatorStatus} />
        {desks.map((desk) => (
          <LightBee key={desk.agent.id} desk={desk} swarmRef={swarmRef} />
        ))}
        <DelegationBeams desks={desks} swarmRef={swarmRef} coordinatorId={coordinatorId} />
        <ActivityBursts desks={desks} swarmRef={swarmRef} />
        <ReturnPackets desks={desks} swarmRef={swarmRef} />
        <ParticleField />
        <Effects quality={quality} />
        <QualityGuard />
      </Suspense>
    </Canvas>
  );
}
