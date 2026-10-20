/**
 * Controles de escena: desplazar, girar y acercar, como en la Oficina 3D.
 *
 * Arrastrar con el botón izquierdo DESPLAZA la escena (con shift, o con el
 * derecho, la gira); la rueda acerca y aleja. Antes el desplazamiento estaba
 * en el botón derecho, que casi nadie prueba, y la única manera "visible" de
 * mover a BIA era el zoom: acabar con ella fuera de foco o descentrada era
 * fácil y no había forma obvia de arreglarlo.
 *
 * El objetivo de la cámara tiene topes para que BIA no se pierda por completo
 * fuera de pantalla, y un doble clic devuelve el encuadre de partida. Ese
 * mismo ajuste vive en el panel de flechas del HUD (`mover` y `acercar`).
 *
 * La cámara no se mueve sola: una figura que se balancea sin motivo se lee
 * como un fallo, no como profundidad.
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MOUSE, TOUCH, Vector3 } from "three";

/** Encuadre de partida: el mismo con el que abre la escena. */
const POSICION_INICIAL = new Vector3(0, 0.15, 6.2);
const OBJETIVO = new Vector3(0, 0.05, 0);

const DIST_MIN = 2.4;
const DIST_MAX = 13;

/** Hasta dónde puede irse el punto que mira la cámara. */
const LIMITE = { x: 4.5, yMin: -2.8, yMax: 3.2, z: 2.5 };

export interface SceneControlsHandle {
  recentrar: () => void;
  /** Desplaza la escena; `dx` y `dy` en pasos de pantalla (+x derecha, +y arriba). */
  mover: (dx: number, dy: number) => void;
  /** Acerca (<1) o aleja (>1) multiplicando la distancia actual. */
  acercar: (factor: number) => void;
}

interface SceneControlsProps {
  /** Se llama la primera vez que el usuario mueve la cámara. */
  onTomarControl: () => void;
  /** Se llama al volver al encuadre de partida (doble clic). */
  onRecentrar?: () => void;
  handleRef?: Ref<SceneControlsHandle>;
}

export function SceneControls({ onTomarControl, onRecentrar, handleRef }: SceneControlsProps) {
  const controls = useRef<any>(null);
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const avisado = useRef(false);

  const recentrar = () => {
    camera.position.copy(POSICION_INICIAL);
    const c = controls.current;
    if (c) {
      c.target.copy(OBJETIVO);
      c.update();
    }
    avisado.current = false;
  };

  /** Mantiene el objetivo dentro de los topes arrastrando la cámara con él. */
  const acotar = () => {
    const c = controls.current;
    if (!c) return;
    const t: Vector3 = c.target;
    const dx = Math.min(LIMITE.x, Math.max(-LIMITE.x, t.x)) - t.x;
    const dy = Math.min(LIMITE.yMax, Math.max(LIMITE.yMin, t.y)) - t.y;
    const dz = Math.min(LIMITE.z, Math.max(-LIMITE.z, t.z)) - t.z;
    if (dx || dy || dz) {
      t.x += dx;
      t.y += dy;
      t.z += dz;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
  };

  useImperativeHandle(handleRef, () => ({
    recentrar,
    mover: (dx, dy) => {
      const c = controls.current;
      if (!c) return;
      const paso = camera.position.distanceTo(c.target) * 0.12;
      const derecha = new Vector3().setFromMatrixColumn(camera.matrix, 0);
      const arriba = new Vector3().setFromMatrixColumn(camera.matrix, 1);
      const desp = derecha.multiplyScalar(dx * paso).add(arriba.multiplyScalar(dy * paso));
      c.target.add(desp);
      camera.position.add(desp);
      acotar();
      c.update();
      if (!avisado.current) {
        avisado.current = true;
        onTomarControl();
      }
    },
    acercar: (factor) => {
      const c = controls.current;
      if (!c) return;
      const desde = camera.position.clone().sub(c.target);
      const dist = Math.min(DIST_MAX, Math.max(DIST_MIN, desde.length() * factor));
      camera.position.copy(c.target).add(desde.setLength(dist));
      c.update();
      if (!avisado.current) {
        avisado.current = true;
        onTomarControl();
      }
    },
  }));

  useEffect(() => {
    const c = controls.current;
    if (c) {
      c.target.copy(OBJETIVO);
      c.update();
    }
  }, []);

  // Doble clic: volver al encuadre de partida desde cualquier sitio.
  useEffect(() => {
    const alDobleClic = () => {
      recentrar();
      onRecentrar?.();
    };
    dom.addEventListener("dblclick", alDobleClic);
    return () => dom.removeEventListener("dblclick", alDobleClic);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      screenSpacePanning
      // Izquierdo desplaza; con shift o ctrl, el mismo botón gira. Derecho gira.
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      // Un dedo desplaza; dos acercan y giran.
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
      // Cerca alcanza para mirarle la cara; lejos, para ver la escena entera.
      minDistance={DIST_MIN}
      maxDistance={DIST_MAX}
      // Sin estos topes se puede orbitar por debajo del suelo y ver el telón
      // por detrás, que es un plano y se ve como una lámina.
      minPolarAngle={0.55}
      maxPolarAngle={1.95}
      panSpeed={0.9}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      onChange={acotar}
      onStart={() => {
        if (!avisado.current) {
          avisado.current = true;
          onTomarControl();
        }
      }}
    />
  );
}
