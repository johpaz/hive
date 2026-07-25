import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial } from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { burstVertex, burstFragment } from "../shaders/particles.glsl";
import type { SwarmRef } from "./swarm";

const PARTICLES_PER_BURST = 64;
const BURST_TTL_MS = 1700;

interface Burst {
  id: number;
  position: [number, number, number];
  color: string;
}

interface BurstsProps {
  desks: DeskModel[];
  swarmRef: SwarmRef;
}

let burstSeq = 0;

/** Estallido de partículas cuando un agente termina un tool_call. */
export function ActivityBursts({ desks, swarmRef }: BurstsProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const prevStates = useRef<Map<string, DeskModel["state"]>>(new Map());

  useEffect(() => {
    const prev = prevStates.current;
    for (const desk of desks) {
      const before = prev.get(desk.agent.id);
      if (before === "tool_call" && desk.state !== "tool_call") {
        const bee = swarmRef.current.get(desk.agent.id);
        if (bee) {
          const id = ++burstSeq;
          setBursts((b) => [...b, { id, position: bee.pos.toArray() as [number, number, number], color: desk.color }]);
          setTimeout(() => {
            setBursts((b) => b.filter((x) => x.id !== id));
          }, BURST_TTL_MS);
        }
      }
      prev.set(desk.agent.id, desk.state);
    }
  }, [desks, swarmRef]);

  return (
    <group>
      {bursts.map((b) => (
        <BurstCloud key={b.id} burst={b} />
      ))}
    </group>
  );
}

function BurstCloud({ burst }: { burst: Burst }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array(PARTICLES_PER_BURST * 3); // origen local
    const vels = new Float32Array(PARTICLES_PER_BURST * 3);
    const seeds = new Float32Array(PARTICLES_PER_BURST);
    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      // Dirección esférica aleatoria
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.6 + Math.random() * 1.4;
      vels[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      vels[i * 3 + 1] = Math.cos(phi) * speed * 0.9;
      vels[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      seeds[i] = Math.random();
    }
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("aVel", new Float32BufferAttribute(vels, 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uStart: { value: -1 },
      uColor: { value: new Color(burst.color) },
      uPixelRatio: { value: 1 },
    }),
    [burst.color],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    if (uniforms.uStart.value < 0) uniforms.uStart.value = state.clock.elapsedTime;
    uniforms.uPixelRatio.value = state.viewport.dpr;
  });

  return (
    <points geometry={geometry} position={burst.position} frustumCulled={false}>
      <shaderMaterial
        vertexShader={burstVertex}
        fragmentShader={burstFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
