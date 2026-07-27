import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import type { MotionMode } from "../state/office3dStore";
import {
  beeOrbit,
  orbitPosition,
  speedFactor,
  targetRadius,
  targetY,
  type SwarmRef,
  type BeeState,
} from "./swarm";

interface SwarmDriverProps {
  desks: DeskModel[];
  swarmRef: SwarmRef;
  motion: MotionMode;
}

const _pos = new Vector3();

/**
 * Único driver de cinemática del enjambre. Corre antes que el resto de
 * useFrame (prioridad -1) y escribe posiciones vivas en `swarmRef`; los
 * consumidores (abejas, beams, suelo, estallidos, cámara) solo leen.
 * Cero re-renders de React por frame.
 */
export function SwarmDriver({ desks, swarmRef, motion }: SwarmDriverProps) {
  // Órbitas hogar estables por agente (orden de llegada de desks)
  const orbits = useMemo(
    () => new Map(desks.map((d, i) => [d.agent.id, beeOrbit(i, desks.length)])),
    [desks],
  );
  const deskRef = useRef(desks);
  useEffect(() => {
    deskRef.current = desks;
  }, [desks]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const map = swarmRef.current;

    for (const desk of deskRef.current) {
      const id = desk.agent.id;
      const spec = orbits.get(id);
      if (!spec) continue;

      let bee = map.get(id);
      if (!bee) {
        const [x, y, z] = orbitPosition(spec, spec.radius, spec.yBase, spec.phase, t);
        bee = {
          pos: new Vector3(x, y, z),
          prevPos: new Vector3(x, y, z),
          angle: spec.phase,
          radius: spec.radius,
          y: spec.yBase,
          speedMul: 1,
        };
        map.set(id, bee);
      }

      const hasTask = !!desk.currentTask;
      const wantRadius = targetRadius(desk.state, hasTask, spec.radius);
      const wantY = targetY(desk.state, hasTask, spec.yBase);
      const wantSpeed = motion === "off" ? 0 : speedFactor(desk.state, hasTask);

      // Transiciones suaves exponenciales (framerate-independientes)
      const k = 1 - Math.pow(0.12, delta);
      bee.radius += (wantRadius - bee.radius) * k;
      bee.y += (wantY - bee.y) * k;
      bee.speedMul += (wantSpeed - bee.speedMul) * k;

      bee.angle += spec.angularSpeed * bee.speedMul * delta;

      bee.prevPos.copy(bee.pos);
      const [x, y, z] = orbitPosition(spec, bee.radius, bee.y, bee.angle, t);
      _pos.set(x, y, z);

      // stuck: jitter errático
      if (motion === "calm" && desk.state === "stuck") {
        _pos.x += Math.sin(t * 31 + spec.phase * 7) * 0.22;
        _pos.y += Math.cos(t * 41 + spec.phase * 3) * 0.15;
        _pos.z += Math.sin(t * 37 + spec.phase * 5) * 0.22;
      }

      bee.pos.copy(_pos);
    }

    // Purga abejas que ya no existen
    for (const id of map.keys()) {
      if (!orbits.has(id)) map.delete(id);
    }
  }, -1);

  return null;
}
