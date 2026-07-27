import { Vector3 } from "three";

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

/**
 * Encuadra un evento desde una vista casi cenital. El pequeño desplazamiento
 * sobre Z evita la singularidad de OrbitControls al mirar exactamente a 90°.
 */
export function eventCameraPose(source: Vector3 | null, target: Vector3): CameraPose {
  const focusTarget = target.clone();
  let spread = 0;

  if (source) {
    spread = source.distanceTo(target);
    focusTarget.add(source).multiplyScalar(0.5);
  }

  const height = Math.max(22, 14 + spread * 1.05);
  return {
    target: focusTarget,
    position: new Vector3(focusTarget.x, focusTarget.y + height, focusTarget.z + 0.8),
  };
}
