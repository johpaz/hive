import { useRef, type ElementRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import { useOffice3DStore } from "../state/office3dStore";
import type { SwarmRef } from "./swarm";

type OrbitControlsRef = ElementRef<typeof OrbitControls>;

const INTRO_FROM = new Vector3(0, 46, 62);
const INTRO_TO = new Vector3(0, 15.5, 24.5);
const INTRO_SECONDS = 3.2;
const DEFAULT_TARGET = new Vector3(0, 2.2, 0);

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function CameraRig({
  selectedAgentId,
  swarmRef,
}: {
  selectedAgentId: string | null;
  swarmRef: SwarmRef;
}) {
  const controlsRef = useRef<OrbitControlsRef>(null);
  const camera = useThree((s) => s.camera);
  const introDone = useOffice3DStore((s) => s.introDone);
  const setIntroDone = useOffice3DStore((s) => s.setIntroDone);
  const introStart = useRef<number | null>(null);
  const desiredTarget = useRef(DEFAULT_TARGET.clone());

  useFrame((state) => {
    if (!introDone) {
      if (introStart.current === null) {
        introStart.current = state.clock.elapsedTime;
        camera.position.copy(INTRO_FROM);
      }
      const t = Math.min(1, (state.clock.elapsedTime - introStart.current) / INTRO_SECONDS);
      camera.position.lerpVectors(INTRO_FROM, INTRO_TO, easeOutCubic(t));
      camera.lookAt(DEFAULT_TARGET);
      if (t >= 1) setIntroDone();
      return;
    }
    const controls = controlsRef.current;
    if (controls) {
      const selected = selectedAgentId ? swarmRef.current.get(selectedAgentId) : null;
      desiredTarget.current.copy(selected?.pos ?? DEFAULT_TARGET);
      controls.target.lerp(desiredTarget.current, 0.05);
      controls.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={introDone}
      enableDamping
      dampingFactor={0.06}
      enablePan={false}
      minDistance={9}
      maxDistance={60}
      maxPolarAngle={1.42}
      autoRotate={introDone && !selectedAgentId}
      autoRotateSpeed={0.35}
    />
  );
}
