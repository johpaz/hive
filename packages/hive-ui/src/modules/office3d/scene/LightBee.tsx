import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Trail } from "@react-three/drei";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { humanizeTool } from "@/modules/office3d/state/toolLabels";
import { hologramVertex, hologramFragment } from "../shaders/hologram.glsl";
import { useOffice3DStore } from "../state/office3dStore";
import type { SwarmRef } from "./swarm";
import { ToolHologram } from "./ToolHologram";

interface LightBeeProps {
  desk: DeskModel;
  swarmRef: SwarmRef;
}

const _dir = new Vector3();
const _mat = new Matrix4();
const _quat = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _origin = new Vector3(0, 0, 0);

/** Aleteo (rad/s de oscilación) e intensidad según estado. */
const FLAP_BY_STATE: Record<DeskModel["state"], { flap: number; intensity: number; opacity: number }> = {
  archived: { flap: 0, intensity: 0.08, opacity: 0.12 },
  idle: { flap: 0, intensity: 0.45, opacity: 0.72 },
  thinking: { flap: 5, intensity: 0.85, opacity: 0.9 },
  tool_call: { flap: 8, intensity: 1.05, opacity: 1.0 },
  stuck: { flap: 2, intensity: 0.9, opacity: 0.95 },
  disabled: { flap: 0, intensity: 0.12, opacity: 0.06 },
};

export function LightBee({ desk, swarmRef }: LightBeeProps) {
  const { agent, state, color } = desk;
  const selected = useOffice3DStore((s) => s.selectedAgentId === agent.id);
  const select = useOffice3DStore((s) => s.select);
  const motion = useOffice3DStore((s) => s.motion);
  const activeCue = useOffice3DStore((s) => s.activeCue);

  const rootRef = useRef<Group>(null);
  const beeRef = useRef<Group>(null);
  const gestureRef = useRef<Group>(null);
  const wingL = useRef<Mesh>(null);
  const wingR = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);

  const bodyMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: hologramVertex,
        fragmentShader: hologramFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new Color(color) },
          uIntensity: { value: 0.65 },
          uGlitch: { value: 0 },
          uOpacity: { value: 0.8 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [color],
  );

  const wingMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: hologramVertex,
        fragmentShader: hologramFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new Color(color).lerp(new Color("#ffffff"), 0.55) },
          uIntensity: { value: 0.9 },
          uGlitch: { value: 0 },
          uOpacity: { value: 0.4 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [color],
  );
  const trailColor = useMemo(() => new Color(color), [color]);

  useFrame((state3, delta) => {
    const t = state3.clock.elapsedTime;
    const tune = FLAP_BY_STATE[state];
    const participant = activeCue?.actorId === agent.id || activeCue?.targetId === agent.id;
    const emphasis = activeCue && !participant && !selected ? 0.28 : 1;
    bodyMat.uniforms.uTime.value = t;
    wingMat.uniforms.uTime.value = t;

    const lerp = 1 - Math.pow(0.002, delta);
    bodyMat.uniforms.uIntensity.value += (tune.intensity - bodyMat.uniforms.uIntensity.value) * lerp;
    bodyMat.uniforms.uOpacity.value += (tune.opacity * emphasis - bodyMat.uniforms.uOpacity.value) * lerp;
    wingMat.uniforms.uOpacity.value += (0.4 * emphasis - wingMat.uniforms.uOpacity.value) * lerp;
    bodyMat.uniforms.uGlitch.value += ((state === "stuck" ? 1 : 0) - bodyMat.uniforms.uGlitch.value) * lerp;

    // Posición viva desde el driver
    const bee = swarmRef.current.get(agent.id);
    if (bee && rootRef.current) {
      rootRef.current.position.copy(bee.pos);
      // Orientación: mirar en la dirección del movimiento
      if (beeRef.current) {
        _dir.subVectors(bee.pos, bee.prevPos);
        if (_dir.lengthSq() > 1e-8) {
          _mat.lookAt(_dir, _origin, _up);
          _quat.setFromRotationMatrix(_mat);
          beeRef.current.quaternion.slerp(_quat, 1 - Math.pow(0.01, delta));
        }
      }
    }

    // Aleteo
    const flapAngle = motion === "calm" && tune.flap > 0 ? Math.sin(t * tune.flap) * 0.45 + 0.2 : 0.15;
    if (wingL.current) wingL.current.rotation.z = flapAngle;
    if (wingR.current) wingR.current.rotation.z = -flapAngle;

    if (lightRef.current) {
      const target = state === "disabled" || state === "archived" ? 0 : state === "tool_call" ? 7 : 2.6;
      lightRef.current.intensity += (target - lightRef.current.intensity) * lerp;
    }

    if (gestureRef.current) {
      const acknowledging = activeCue?.phase === "delegated" && activeCue.targetId === agent.id;
      const reporting =
        activeCue?.actorId === agent.id &&
        (activeCue.phase === "completed" || activeCue.phase === "failed");
      const targetPitch =
        motion === "calm" && acknowledging
          ? Math.sin(t * 8.5) * 0.22
          : motion === "calm" && reporting
            ? -0.16
            : 0;
      gestureRef.current.rotation.x = MathUtils.damp(
        gestureRef.current.rotation.x,
        targetPitch,
        7,
        delta,
      );
      const targetScale = participant && motion === "calm" ? 1.12 : 1;
      const scale = MathUtils.damp(gestureRef.current.scale.x, targetScale, 6, delta);
      gestureRef.current.scale.setScalar(scale);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(selected ? null : agent.id);
  };

  const toolLabel = state === "tool_call" ? humanizeTool(desk.currentTool) : null;

  return (
    <group ref={rootRef}>
      <group
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <Trail
          width={state === "idle" || state === "disabled" || state === "archived" ? 0 : 0.65}
          length={2.2}
          color={trailColor}
          attenuation={(w) => w * w}
        >
          <group ref={beeRef} scale={selected ? 0.85 : 0.62}>
            <group ref={gestureRef}>
            {/* Abdomen (cápsula) */}
            <mesh material={bodyMat} scale={[0.85, 0.75, 1.35]}>
              <sphereGeometry args={[0.32, 14, 14]} />
            </mesh>
            {/* Franjas del tórax */}
            <mesh position={[0, 0, 0.1]}>
              <torusGeometry args={[0.24, 0.045, 8, 20]} />
              <meshStandardMaterial color="#241804" metalness={0.4} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, -0.14]}>
              <torusGeometry args={[0.22, 0.04, 8, 20]} />
              <meshStandardMaterial color="#241804" metalness={0.4} roughness={0.6} />
            </mesh>
            {/* Cabeza */}
            <mesh material={bodyMat} position={[0, 0.03, 0.5]}>
              <sphereGeometry args={[0.18, 12, 12]} />
            </mesh>
            {/* Aguijón */}
            <mesh material={bodyMat} position={[0, 0, -0.52]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.07, 0.22, 8]} />
            </mesh>
            {/* Alas */}
            <mesh ref={wingL} material={wingMat} position={[0.26, 0.24, 0.05]} rotation={[0.35, 0, 0.5]} scale={[1, 0.08, 0.55]}>
              <sphereGeometry args={[0.3, 10, 10]} />
            </mesh>
            <mesh ref={wingR} material={wingMat} position={[-0.26, 0.24, 0.05]} rotation={[0.35, 0, -0.5]} scale={[1, 0.08, 0.55]}>
              <sphereGeometry args={[0.3, 10, 10]} />
            </mesh>
            </group>
          </group>
        </Trail>
      </group>

      <pointLight ref={lightRef} color={color} intensity={2.6} distance={8} decay={1.7} />

      {state === "tool_call" && <ToolHologram toolName={desk.currentTool} color={color} />}
      {state === "thinking" && (
        <mesh position={[0, 0.95, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.52, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.42} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
      {state === "stuck" && (
        <mesh position={[0, 1.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.68, 6]} />
          <meshBasicMaterial color="#fb7185" transparent opacity={0.86} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      )}

      {/* Tarea delegada en curso */}
      {desk.currentTask && (
        <Html position={[0, 1.55, 0]} center distanceFactor={17} className="pointer-events-none select-none">
          <div className="office3d-task-chip" style={{ ["--chip-color" as string]: color }}>
            <span className="office3d-task-chip-prefix">◈</span> {desk.currentTask}
          </div>
        </Html>
      )}

      {/* Herramienta en curso */}
      {toolLabel && (
        <Html position={[0, desk.currentTask ? 1.05 : 1.3, 0]} center distanceFactor={17} className="pointer-events-none select-none">
          <div className="office3d-tool-chip" style={{ ["--chip-color" as string]: color }}>
            {toolLabel}
          </div>
        </Html>
      )}

      {/* Placa de nombre permanente */}
      <Html position={[0, -0.85, 0]} center distanceFactor={16} className="pointer-events-none select-none" zIndexRange={[10, 0]}>
        <div className={`office3d-name-plate ${selected ? "is-active" : ""}`} style={{ ["--chip-color" as string]: color }}>
          <span className={`office3d-name-dot office3d-name-dot--${state}`} />
          <span>
            <strong>{agent.name}</strong>
            <small>{agent.description || "Agente especialista"}</small>
          </span>
        </div>
      </Html>
    </group>
  );
}
