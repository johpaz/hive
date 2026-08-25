/**
 * Controles de escena: órbita, zoom y desplazamiento, como en la Oficina 3D.
 *
 * Conviven con el paralaje automático mediante una regla simple: el paralaje
 * mueve la cámara sólo mientras nadie la haya tocado. En cuanto el usuario
 * arrastra o hace zoom, el automatismo se apaga — si no, la escena "tiraría"
 * de vuelta y daría la sensación de que los controles no responden. El botón de
 * recentrar devuelve la vista y vuelve a encender el paralaje.
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";

/** Encuadre de partida: el mismo con el que abre la escena. */
const POSICION_INICIAL = new Vector3(0, 0.15, 6.2);
const OBJETIVO = new Vector3(0, 0.05, 0);

export interface SceneControlsHandle {
  recentrar: () => void;
}

interface SceneControlsProps {
  /** Se llama la primera vez que el usuario mueve la cámara. */
  onTomarControl: () => void;
  handleRef?: Ref<SceneControlsHandle>;
}

export function SceneControls({ onTomarControl, handleRef }: SceneControlsProps) {
  const controls = useRef<any>(null);
  const camera = useThree((s) => s.camera);
  const avisado = useRef(false);

  useImperativeHandle(handleRef, () => ({
    recentrar: () => {
      camera.position.copy(POSICION_INICIAL);
      const c = controls.current;
      if (c) {
        c.target.copy(OBJETIVO);
        c.update();
      }
      avisado.current = false;
    },
  }));

  useEffect(() => {
    const c = controls.current;
    if (c) {
      c.target.copy(OBJETIVO);
      c.update();
    }
  }, []);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      // Cerca alcanza para mirarle la cara; lejos, para ver la escena entera.
      minDistance={2.4}
      maxDistance={13}
      // Sin estos topes se puede orbitar por debajo del suelo y ver el telón
      // por detrás, que es un plano y se ve como una lámina.
      minPolarAngle={0.55}
      maxPolarAngle={1.95}
      panSpeed={0.6}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      onStart={() => {
        if (!avisado.current) {
          avisado.current = true;
          onTomarControl();
        }
      }}
    />
  );
}
