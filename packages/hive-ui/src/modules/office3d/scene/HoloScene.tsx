import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { CanvasWorkEvent, GraphNode } from "@/stores/canvasStore";
import type { DeskModel, OfficeInteraction } from "@/modules/office3d/state/useOfficeModel";
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
import { WorkTransfers } from "./WorkTransfers";
import { SceneDirector } from "./SceneDirector";
import type { BeeState } from "./swarm";

interface HoloSceneProps {
  desks: DeskModel[];
  coordinator: GraphNode | null;
  interactions: OfficeInteraction[];
  workEvents: CanvasWorkEvent[];
}

export function HoloScene({ desks, coordinator, interactions, workEvents }: HoloSceneProps) {
  const quality = useOffice3DStore((s) => s.quality);
  const setQuality = useOffice3DStore((s) => s.setQuality);
  const motion = useOffice3DStore((s) => s.motion);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const effectiveMotion = reducedMotion ? "off" : motion;
  const selectedAgentId = useOffice3DStore((s) => s.selectedAgentId);
  const select = useOffice3DStore((s) => s.select);
  const swarmRef = useRef<Map<string, BeeState>>(new Map());
  const anyActive = desks.some((d) => d.state === "thinking" || d.state === "tool_call" || d.state === "stuck");

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
        <SceneDirector
          events={workEvents}
          desks={desks}
          coordinatorId={coordinator?.id ?? null}
        />
        <SwarmDriver desks={desks} swarmRef={swarmRef} motion={effectiveMotion} />
        <CameraRig
          coordinatorId={coordinator?.id ?? null}
          selectedAgentId={selectedAgentId}
          swarmRef={swarmRef}
          motion={effectiveMotion}
        />
        <HexFloor />
        <HiveCore
          coordinator={coordinator}
          active={anyActive}
          swarmRef={swarmRef}
        />
        {desks.map((desk) => (
          <LightBee key={desk.agent.id} desk={desk} swarmRef={swarmRef} />
        ))}
        <DelegationBeams
          desks={desks}
          interactions={interactions}
          swarmRef={swarmRef}
          coordinatorId={coordinator?.id ?? null}
        />
        {effectiveMotion === "calm" && (
          <WorkTransfers
            desks={desks}
            events={workEvents}
            swarmRef={swarmRef}
            coordinatorId={coordinator?.id ?? null}
            coordinatorName={coordinator?.name ?? "Coordinador"}
          />
        )}
        {effectiveMotion === "calm" && quality === "high" && <ActivityBursts desks={desks} swarmRef={swarmRef} />}
        {effectiveMotion === "calm" && quality === "high" && <ParticleField />}
        <Effects quality={quality} />
        <PerformanceMonitor
          bounds={(refreshRate) => [Math.min(42, refreshRate * 0.68), refreshRate * 0.92]}
          onDecline={() => {
            if (quality === "high") setQuality("low");
          }}
        />
      </Suspense>
    </Canvas>
  );
}
