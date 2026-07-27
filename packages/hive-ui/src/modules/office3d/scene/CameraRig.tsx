import { useEffect, useRef, useState, type ElementRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import { useOffice3DStore } from "../state/office3dStore";
import type { MotionMode } from "../state/office3dStore";
import type { SwarmRef } from "./swarm";
import { eventCameraPose, type CameraPose } from "./cameraFocus";

type OrbitControlsRef = ElementRef<typeof OrbitControls>;

const INTRO_FROM = new Vector3(0, 46, 62);
const INTRO_TO = new Vector3(0, 15.5, 24.5);
const INTRO_SECONDS = 1.35;
const DEFAULT_TARGET = new Vector3(0, 2.2, 0);
const DEFAULT_POSITION = new Vector3(0, 15.5, 24.5);
const CORE_FOCUS = new Vector3(0, 3.1, 0);
const RETURN_EPSILON = 0.025;

interface FocusCue {
  sourceId: string | null;
  targetId: string;
  phase: "focus" | "return";
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function CameraRig({
  coordinatorId,
  selectedAgentId,
  swarmRef,
  motion,
}: {
  coordinatorId: string | null;
  selectedAgentId: string | null;
  swarmRef: SwarmRef;
  motion: MotionMode;
}) {
  const controlsRef = useRef<OrbitControlsRef>(null);
  const camera = useThree((s) => s.camera);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const introDone = useOffice3DStore((s) => s.introDone);
  const setIntroDone = useOffice3DStore((s) => s.setIntroDone);
  const activeCue = useOffice3DStore((s) => s.activeCue);
  const introStart = useRef<number | null>(null);
  const sceneInitialized = useRef(false);
  const [desiredTarget] = useState(() => DEFAULT_TARGET.clone());
  const [desiredPosition] = useState(() => DEFAULT_POSITION.clone());
  const focusCue = useRef<FocusCue | null>(null);
  const restingPose = useRef<CameraPose>({
    position: DEFAULT_POSITION.clone(),
    target: DEFAULT_TARGET.clone(),
  });
  const selectionFollowing = useRef(false);

  useEffect(() => {
    if (motion !== "calm" || reducedMotion) {
      focusCue.current = null;
      return;
    }
    if (activeCue) {
      focusCue.current = {
        sourceId: activeCue.actorId,
        targetId: activeCue.targetId || coordinatorId || activeCue.actorId,
        phase: "focus",
      };
    } else if (focusCue.current?.phase === "focus") {
      focusCue.current.phase = "return";
    }
  }, [activeCue, coordinatorId, motion, reducedMotion]);

  useEffect(() => {
    if (selectedAgentId) {
      selectionFollowing.current = true;
    } else if (selectionFollowing.current) {
      selectionFollowing.current = false;
      focusCue.current = { sourceId: null, targetId: "", phase: "return" };
    }
  }, [selectedAgentId]);

  useFrame((state, delta) => {
    if (reducedMotion && !introDone) {
      camera.position.copy(DEFAULT_POSITION);
      camera.lookAt(DEFAULT_TARGET);
      setIntroDone();
      return;
    }
    if (!introDone) {
      if (introStart.current === null) {
        introStart.current = state.clock.elapsedTime;
        camera.position.copy(INTRO_FROM);
      }
      const t = Math.min(1, (state.clock.elapsedTime - introStart.current) / INTRO_SECONDS);
      camera.position.lerpVectors(INTRO_FROM, INTRO_TO, easeOutCubic(t));
      camera.lookAt(DEFAULT_TARGET);
      if (t >= 1) {
        restingPose.current.position.copy(DEFAULT_POSITION);
        restingPose.current.target.copy(DEFAULT_TARGET);
        setIntroDone();
      }
      return;
    }
    const controls = controlsRef.current;
    if (controls) {
      if (!sceneInitialized.current) {
        camera.position.copy(DEFAULT_POSITION);
        controls.target.copy(DEFAULT_TARGET);
        restingPose.current.position.copy(DEFAULT_POSITION);
        restingPose.current.target.copy(DEFAULT_TARGET);
        controls.update();
        sceneInitialized.current = true;
        return;
      }
      const cue = focusCue.current;
      if (cue && motion === "calm" && !reducedMotion) {
        if (cue.phase === "focus") {
          const source = cue.sourceId === coordinatorId
            ? CORE_FOCUS
            : cue.sourceId
              ? swarmRef.current.get(cue.sourceId)?.pos
              : null;
          const target = cue.targetId === coordinatorId
            ? CORE_FOCUS
            : swarmRef.current.get(cue.targetId)?.pos;

          if (target) {
            const pose = eventCameraPose(source ?? null, target);
            desiredTarget.copy(pose.target);
            desiredPosition.copy(pose.position);
          }
        } else {
          const selected =
            selectedAgentId === coordinatorId
              ? CORE_FOCUS
              : selectedAgentId
                ? swarmRef.current.get(selectedAgentId)?.pos
                : null;
          if (selectionFollowing.current && selected) {
            desiredTarget.copy(selected);
            desiredPosition.set(selected.x, selected.y + 7, selected.z + 11);
          } else {
            desiredTarget.copy(restingPose.current.target);
            desiredPosition.copy(restingPose.current.position);
          }
        }

        const targetDamping = 1 - Math.pow(0.035, delta);
        const cameraDamping = 1 - Math.pow(0.06, delta);
        controls.target.lerp(desiredTarget, targetDamping);
        camera.position.lerp(desiredPosition, cameraDamping);
        if (
          cue.phase === "return" &&
          controls.target.distanceToSquared(desiredTarget) < RETURN_EPSILON &&
          camera.position.distanceToSquared(desiredPosition) < RETURN_EPSILON
        ) {
          focusCue.current = null;
        }
      } else if (selectionFollowing.current && selectedAgentId && motion === "calm" && !reducedMotion) {
        const selected =
          selectedAgentId === coordinatorId
            ? CORE_FOCUS
            : swarmRef.current.get(selectedAgentId)?.pos;
        if (selected) {
          desiredTarget.copy(selected);
          desiredPosition.set(selected.x, selected.y + 7, selected.z + 11);
          controls.target.lerp(desiredTarget, 1 - Math.pow(0.035, delta));
          camera.position.lerp(desiredPosition, 1 - Math.pow(0.06, delta));
        }
      }
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
      enablePan
      minDistance={9}
      maxDistance={60}
      maxPolarAngle={1.42}
      autoRotate={false}
      onStart={() => {
        focusCue.current = null;
        selectionFollowing.current = false;
      }}
      onEnd={() => {
        const controls = controlsRef.current;
        if (!controls) return;
        restingPose.current.position.copy(camera.position);
        restingPose.current.target.copy(controls.target);
      }}
    />
  );
}
