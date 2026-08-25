/**
 * Escenario de HiveLive.
 *
 * Todo lo que se ve aquí es propio del módulo: el telón de panal y el polen se
 * escribieron para esta escena en vez de reutilizar los de la Oficina 3D, que
 * son azules y están calculados para una cámara cenital a 60 unidades — en
 * primer plano peleaban con la paleta dorada de BIA y le robaban la atención.
 *
 * La profundidad se construye por planos: telón al fondo, anillos de espectro
 * flotando delante, BIA en el centro con relieve propio, y polen envolviéndola.
 *
 * La cámara no se mueve sola. Hubo una deriva automática —pensada para que el
 * relieve del retrato se leyera sin tocar nada— y un seguimiento del puntero;
 * los dos se quitaron porque una figura que se balancea sin motivo se lee como
 * un fallo, no como profundidad. Ahora el encuadre sólo cambia si se arrastra
 * con el ratón, y el botón de recentrar lo devuelve a su sitio.
 */

import { Suspense, useRef, type Ref } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Noise, Vignette, DepthOfField } from "@react-three/postprocessing";
import { AudioSampler, useAudioPulse } from "./audioPulse";
import { SpectrumRing } from "./SpectrumRing";
import { BiaPortrait, type BiaState } from "./BiaPortrait";
import { BiaModel } from "./BiaModel";
import { HexBackdrop } from "./HexBackdrop";
import { SceneControls, type SceneControlsHandle } from "./SceneControls";
import { Pollen } from "./Pollen";
import { EnergyProbe } from "./EnergyProbe";

interface VoiceStageProps {
  live: boolean;
  working: boolean;
  /** Estado lento de BIA; quién habla lo resuelve ella con el audio. */
  baseState: BiaState;
  className?: string;
  /** Avisa al HUD de que la cámara pasó a control manual. */
  onTomarControl?: () => void;
  controlsRef?: Ref<SceneControlsHandle>;
  /** "foto" = render con relieve; "modelo" = malla 3D real. */
  avatar?: "foto" | "modelo";
}

const HONEY = "#ffb43a";
const CYAN = "#42d3fc";

export function VoiceStage({
  live,
  working,
  baseState,
  className,
  onTomarControl,
  controlsRef,
  avatar = "modelo",
}: VoiceStageProps) {
  const pulse = useAudioPulse();
  /** Energía compartida con el fondo: sube cuando alguien habla. */
  const energy = useRef(0);
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className={className}>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        // Encuadre de tres cuartos con aire alrededor: antes la figura llenaba
        // la pantalla y se cortaba por abajo.
        camera={{ fov: 32, near: 0.1, far: 60, position: [0, 0.15, 6.2] }}
        fallback={<div className="vx__stage-fallback" />}
      >
        <color attach="background" args={["#05060b"]} />
        <fog attach="fog" args={["#07080f", 6, 20]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 6]} intensity={0.7} color="#ffe0b0" />
        <directionalLight position={[-4, 2, 3]} intensity={0.35} color="#8fd0ff" />

        <AudioSampler pulse={pulse} />
        <EnergyProbe pulse={pulse} energyRef={energy} />

        <Suspense fallback={null}>
          <HexBackdrop working={working} energyRef={energy} accent={HONEY} />

          {/* Los anillos flotan por delante del telón y por detrás de BIA. */}
          <group position={[0, -1.35, -0.9]} rotation={[-Math.PI / 2.1, 0, 0]}>
            <SpectrumRing pulse={pulse} source="mic" color={HONEY} radius={1.5} amount={0.7} />
            <SpectrumRing pulse={pulse} source="voice" color={CYAN} radius={2.15} amount={0.9} />
          </group>

          {avatar === "modelo" ? (
            <BiaModel pulse={pulse} live={live} working={working} baseState={baseState} />
          ) : (
            <BiaPortrait pulse={pulse} live={live} working={working} baseState={baseState} />
          )}
          <Pollen energyRef={energy} />

          <SceneControls onTomarControl={() => onTomarControl?.()} handleRef={controlsRef} />

          {!reducedMotion && (
            <EffectComposer multisampling={0}>
              {/*
               * Sólo florece lo que ya brilla: ojos, núcleo y líneas del traje.
               * El umbral es alto a propósito — más bajo, el bloom se comía la
               * piel iluminada y le ponía un halo lechoso a la cara.
               */}
              <Bloom mipmapBlur intensity={0.42} luminanceThreshold={0.78} luminanceSmoothing={0.25} />
              {/*
               * Sin profundidad de campo. El relieve deja el rostro y las manos
               * a distancias distintas del plano, así que el desenfoque caía
               * sobre partes del cuerpo y derretía los rasgos. Separar a BIA del
               * telón se resuelve con la niebla y la viñeta, sin tocar la figura.
               */}
              <Noise premultiply opacity={0.22} />
              <Vignette offset={0.3} darkness={0.5} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
