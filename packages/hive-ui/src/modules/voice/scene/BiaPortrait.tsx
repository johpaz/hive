/**
 * BIA en la escena: el retrato con volumen y gesto.
 *
 * La malla lleva relieve (el rostro y las manos sobresalen, las alas quedan
 * detrás), así que con el paralaje de la cámara se lee como un cuerpo dentro
 * del espacio y no como una lámina. Boca, manos y alas se mueven con el audio.
 *
 * El bucle vive fuera de React: el audio cambia 60 veces por segundo y sólo
 * mueve uniforms.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Color, DoubleSide, Group, MathUtils, ShaderMaterial, SRGBColorSpace, TextureLoader } from "three";
import biaUrl from "@/assets/bia.webp";
import type { PulseRef } from "./audioPulse";
import { PORTRAIT_FRAG, PORTRAIT_VERT } from "./biaPortrait.glsl";

export type BiaState = "reposo" | "escucha" | "procesando" | "habla" | "exito" | "alerta";

/** Color del acento por estado: es el código de color de toda la escena. */
const COLOR_ESTADO: Record<BiaState, string> = {
  reposo: "#d8a541",
  escucha: "#ffb43a",
  procesando: "#7a5ff1",
  habla: "#42d3fc",
  exito: "#3fd7a1",
  alerta: "#f2557a",
};

/**
 * Proporción del render original (1024×1536).
 *
 * Con la cámara a 6.2 y 32° de campo, la altura visible es ~3.5: a 2.7 de alto
 * BIA ocupa unos tres cuartos del encuadre y le queda aire arriba y abajo. Antes
 * llenaba la pantalla entera y se cortaba por la cintura.
 */
const ANCHO = 1.8;
const ALTO = ANCHO * 1.5;

interface BiaPortraitProps {
  pulse: PulseRef;
  baseState: BiaState;
  live: boolean;
  working: boolean;
}

export function BiaPortrait({ pulse, baseState, live, working }: BiaPortraitProps) {
  const grupo = useRef<Group>(null);
  const textura = useLoader(TextureLoader, biaUrl);

  useEffect(() => {
    // Sin esto la piel sale lavada: la textura viene en sRGB.
    textura.colorSpace = SRGBColorSpace;
    textura.anisotropy = 4;
    textura.needsUpdate = true;
  }, [textura]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: PORTRAIT_VERT,
        fragmentShader: PORTRAIT_FRAG,
        uniforms: {
          uMap: { value: textura },
          uVoice: { value: 0 },
          uMic: { value: 0 },
          uBlink: { value: 0 },
          uWork: { value: 0 },
          uTime: { value: 0 },
          uLive: { value: 0 },
          // El relieve es relativo al tamaño de la malla. Con valores altos, la
          // perspectiva estira la textura de las zonas elevadas y la cara se ve
          // inflada: da volumen, pero deforma los rasgos.
          uRelieve: { value: 0.16 },
          uAccent: { value: new Color(COLOR_ESTADO.reposo) },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [textura],
  );

  const acentoObjetivo = useMemo(() => new Color(), []);
  const anim = useRef({ voz: 0, mic: 0, live: 0, work: 0, blink: 0, proximoParpadeo: 3 });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const p = pulse.current;
    const a = anim.current;
    const u = material.uniforms;

    // El estado lento viene del store; quién habla se resuelve con el audio.
    const estado: BiaState =
      baseState === "exito" || baseState === "alerta"
        ? baseState
        : !live
          ? "reposo"
          : p.voice > 0.035
            ? "habla"
            : p.mic > 0.05
              ? "escucha"
              : baseState;

    a.voz = MathUtils.damp(a.voz, p.voice, 14, dt);
    a.mic = MathUtils.damp(a.mic, p.mic, 12, dt);
    a.live = MathUtils.damp(a.live, live ? 1 : 0, 2.5, dt);
    a.work = MathUtils.damp(a.work, working ? 1 : 0, 2.5, dt);

    // Parpadeo: cierre rápido, apertura algo más lenta, cada 3–7 s.
    a.proximoParpadeo -= dt;
    if (a.proximoParpadeo <= 0) {
      a.blink = 1;
      a.proximoParpadeo = 3 + Math.random() * 4;
    }
    a.blink = Math.max(0, a.blink - dt * 7);
    const parpadeo = Math.sin(Math.min(1, a.blink) * Math.PI);

    u.uVoice.value = a.voz;
    u.uMic.value = a.mic;
    u.uLive.value = a.live;
    u.uWork.value = a.work;
    u.uBlink.value = parpadeo;
    u.uTime.value = t;

    acentoObjetivo.set(COLOR_ESTADO[estado]);
    (u.uAccent.value as Color).lerp(acentoObjetivo, Math.min(1, dt * 4));

    // Balanceo mínimo del cuerpo: acompaña la respiración sin marear.
    if (grupo.current) {
      // Sin balanceo propio: sólo un apunte hacia quien habla. El vaivén lento
      // que había aquí es el mismo que se quitó del modelo 3D.
      grupo.current.rotation.y = a.mic * 0.03;
      grupo.current.rotation.x = Math.sin(t * 0.24) * 0.012;
      grupo.current.position.y = -0.15 + Math.sin(t * 0.85) * 0.02;
    }
  });

  return (
    <group ref={grupo}>
      <mesh material={material}>
        {/* Muy subdividido: el relieve se desplaza por vértice, y con pocos
            segmentos el rostro saldría facetado. */}
        <planeGeometry args={[ANCHO, ALTO, 160, 240]} />
      </mesh>
    </group>
  );
}
