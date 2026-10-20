/**
 * Panel de flechas para mover a BIA en la escena sin depender del ratón.
 *
 * Mover y acercar no son lo mismo que girar: esto desplaza la vista (arriba,
 * abajo, a los lados) y acerca o aleja. Al mantener pulsado un botón se repite,
 * así que no hace falta clicar veinte veces para cruzar la pantalla.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus } from "lucide-react";
import type { SceneControlsHandle } from "./scene/SceneControls";

/** Cada cuánto se repite la acción mientras el botón sigue pulsado. */
const REPETIR_MS = 60;

function Boton({
  etiqueta,
  onAccion,
  children,
  className = "",
}: {
  etiqueta: string;
  onAccion: () => void;
  children: ReactNode;
  className?: string;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const parar = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => parar, []);

  return (
    <button
      type="button"
      className={`vx__pad-btn ${className}`}
      aria-label={etiqueta}
      title={etiqueta}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onAccion();
        parar();
        timer.current = setInterval(onAccion, REPETIR_MS);
      }}
      onPointerUp={parar}
      onPointerCancel={parar}
      onLostPointerCapture={parar}
    >
      {children}
    </button>
  );
}

export function ScenePad({ controlsRef }: { controlsRef: RefObject<SceneControlsHandle | null> }) {
  const mover = (dx: number, dy: number) => () => controlsRef.current?.mover(dx, dy);
  const acercar = (f: number) => () => controlsRef.current?.acercar(f);

  return (
    <div className="vx__pad vx__glass" role="group" aria-label="Mover a BIA en la escena">
      <Boton etiqueta="Subir" onAccion={mover(0, -0.4)} className="vx__pad-up">
        <ArrowUp className="h-3.5 w-3.5" />
      </Boton>
      <Boton etiqueta="Mover a la izquierda" onAccion={mover(0.4, 0)} className="vx__pad-left">
        <ArrowLeft className="h-3.5 w-3.5" />
      </Boton>
      <Boton etiqueta="Mover a la derecha" onAccion={mover(-0.4, 0)} className="vx__pad-right">
        <ArrowRight className="h-3.5 w-3.5" />
      </Boton>
      <Boton etiqueta="Bajar" onAccion={mover(0, 0.4)} className="vx__pad-down">
        <ArrowDown className="h-3.5 w-3.5" />
      </Boton>
      <Boton etiqueta="Acercar" onAccion={acercar(0.96)} className="vx__pad-in">
        <Plus className="h-3.5 w-3.5" />
      </Boton>
      <Boton etiqueta="Alejar" onAccion={acercar(1.04)} className="vx__pad-out">
        <Minus className="h-3.5 w-3.5" />
      </Boton>
    </div>
  );
}
