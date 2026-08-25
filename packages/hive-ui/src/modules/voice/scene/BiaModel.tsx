/**
 * BIA en malla: el avatar 3D real.
 *
 * A diferencia del retrato fotográfico (BiaPortrait), esta es geometría de
 * verdad: se puede girar con el ratón, la luz la recorre y el volumen no es un
 * truco de relieve.
 * A cambio pierde el acabado cinematográfico del render, así que ambos conviven
 * y el usuario elige.
 *
 * El GLB va SIN compresión Draco a propósito — pesa 2.8 MB en vez de 1.5, pero
 * `useGLTF` con Draco descarga el decodificador de un CDN de Google y la app de
 * escritorio tiene que funcionar sin internet.
 *
 * Meshy no genera rig ni blendshapes, así que los morph targets `mano_izq` y
 * `mano_der` se crearon a mano en Blender: giro de 30° con caída suave alrededor
 * de cada muñeca.
 *
 * NO hay morph target de boca, y no por falta de intentos. Esta malla tiene los
 * labios sellados y fusionados con la piel: separarlos desplazando vértices
 * produce estrías verticales con cualquier amplitud (15°, 10° y 5°) y con
 * cualquier densidad (se subdividió la zona de 275 a 2545 vértices y empeoró).
 * El lip-sync necesita una malla con topología facial y blendshapes de autor,
 * no un parche sobre una malla generada.
 *
 * Mientras tanto, al hablar se enfatiza el gesto del cuerpo: cabeceo, balanceo y
 * manos. Una figura que acompaña la voz con el cuerpo se lee viva aunque los
 * labios no se muevan; una que se queda quieta, no.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, Group, MathUtils, Mesh, MeshStandardMaterial, PointLight } from "three";
import biaGlb from "@/assets/bia.glb";
import type { PulseRef } from "./audioPulse";
import type { BiaState } from "./BiaPortrait";

const COLOR_ESTADO: Record<BiaState, string> = {
  reposo: "#d8a541",
  escucha: "#ffb43a",
  procesando: "#7a5ff1",
  habla: "#42d3fc",
  exito: "#3fd7a1",
  alerta: "#f2557a",
};

interface BiaModelProps {
  pulse: PulseRef;
  baseState: BiaState;
  live: boolean;
  working: boolean;
}

export function BiaModel({ pulse, baseState, live, working }: BiaModelProps) {
  const grupo = useRef<Group>(null);
  const luz = useRef<PointLight>(null);
  const { scene } = useGLTF(biaGlb);

  // El GLB llega con un único material; se clona para poder tocarle la emisión
  // sin alterar la caché que comparte useGLTF entre montajes.
  const modelo = useMemo(() => {
    const copia = scene.clone(true);
    copia.traverse((hijo) => {
      const malla = hijo as Mesh;
      if (!malla.isMesh) return;
      malla.castShadow = false;
      malla.receiveShadow = false;
      const material = malla.material as MeshStandardMaterial;
      if (material?.isMeshStandardMaterial) {
        malla.material = material.clone();
      }
    });
    return copia;
  }, [scene]);

  /** Mallas con morph targets, con el índice de cada gesto ya resuelto. */
  const morphs = useMemo(() => {
    const encontrados: Array<{ malla: Mesh; boca: number; manoIzq: number; manoDer: number }> = [];
    modelo.traverse((hijo) => {
      const malla = hijo as Mesh;
      if (!malla.isMesh || !malla.morphTargetDictionary || !malla.morphTargetInfluences) return;
      const dic = malla.morphTargetDictionary;
      encontrados.push({
        malla,
        boca: dic["boca_abierta"] ?? -1,
        manoIzq: dic["mano_izq"] ?? -1,
        manoDer: dic["mano_der"] ?? -1,
      });
    });
    return encontrados;
  }, [modelo]);

  const materiales = useMemo(() => {
    const lista: MeshStandardMaterial[] = [];
    modelo.traverse((hijo) => {
      const malla = hijo as Mesh;
      if (malla.isMesh && (malla.material as MeshStandardMaterial)?.isMeshStandardMaterial) {
        lista.push(malla.material as MeshStandardMaterial);
      }
    });
    return lista;
  }, [modelo]);

  useEffect(() => {
    // Emisión propia: el traje es oscuro y sin esto la figura se hunde en el
    // fondo negro de la escena.
    for (const m of materiales) {
      m.emissive = new Color("#20222e");
      m.emissiveIntensity = 0.35;
    }
  }, [materiales]);

  const acento = useMemo(() => new Color(COLOR_ESTADO.reposo), []);
  const acentoObjetivo = useMemo(() => new Color(), []);
  const anim = useRef({ voz: 0, mic: 0, live: 0 });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const p = pulse.current;
    const a = anim.current;

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

    a.voz = MathUtils.damp(a.voz, p.voice, 12, dt);
    a.mic = MathUtils.damp(a.mic, p.mic, 10, dt);
    a.live = MathUtils.damp(a.live, live ? 1 : 0, 2.5, dt);

    if (grupo.current) {
      // Respiración, cabeceo y balanceo lateral. Tres periodos distintos y
      // primos entre sí: con uno solo el cuerpo entra en bucle evidente.
      const respira = Math.sin(t * 0.9) * 0.022 + a.voz * 0.012;
      grupo.current.position.y = -1.02 + respira;
      grupo.current.position.x = Math.sin(t * 0.37) * 0.035 + Math.sin(t * 1.9) * 0.006 * a.voz;
      grupo.current.scale.setScalar(1.3 * (1 + a.voz * 0.035));

      // De frente y quieta. Antes acumulaba un ángulo sin fin —más rápido
      // mientras la colmena trabajaba— y acababa dando la espalda a quien le
      // hablaba. Girarla es cosa del ratón; lo único que queda aquí es un
      // apunte mínimo hacia quien habla, que es reacción y no movimiento
      // propio: con el micrófono en silencio vale cero.
      grupo.current.rotation.y = a.mic * 0.08;
      // Cabeceo al hablar. Es lo que sustituye al movimiento de labios, así
      // que pesa más de lo que pesaría en un avatar con lip-sync propio.
      grupo.current.rotation.x =
        Math.sin(t * 1.3) * 0.026 * (0.4 + a.voz * 3.2) + Math.sin(t * 2.7) * 0.008 * a.voz;
      grupo.current.rotation.z = Math.sin(t * 0.61) * 0.012;
    }

    acentoObjetivo.set(COLOR_ESTADO[estado]);
    acento.lerp(acentoObjetivo, Math.min(1, dt * 4));

    for (const m of materiales) {
      m.emissiveIntensity = 0.3 + a.voz * 0.5 + a.live * 0.15;
    }

    // ── Gestos ───────────────────────────────────────────────────────────
    // La boca sigue la voz directamente; las manos se mueven siempre, con un
    // vaivén de base que sube al hablar. Unas manos congeladas delatan a una
    // figura tanto como una boca quieta.
    const balanceo = Math.sin(t * 0.9) * 0.5 + 0.5;
    const vaiven = 0.30 + a.voz * 1.45 + a.mic * 0.3;
    for (const m of morphs) {
      const inf = m.malla.morphTargetInfluences;
      if (!inf) continue;
      if (m.boca >= 0) inf[m.boca] = Math.min(1, a.voz * 1.6);
      if (m.manoIzq >= 0) inf[m.manoIzq] = Math.min(1, balanceo * vaiven);
      if (m.manoDer >= 0) inf[m.manoDer] = Math.min(1, (1 - balanceo) * vaiven);
    }

    if (luz.current) {
      luz.current.color.copy(acento);
      luz.current.intensity = 2 + a.voz * 6 + a.mic * 2;
    }
  });

  return (
    <group ref={grupo} position={[0, -1.02, 0]} scale={1.3}>
      <primitive object={modelo} />
      {/* Luz de acento que sigue el estado, por delante de la figura. */}
      <pointLight ref={luz} position={[0, 1.35, 1.4]} distance={7} decay={1.7} intensity={2} />
    </group>
  );
}

// El asset es grande: se empieza a traer en cuanto se carga el módulo.
useGLTF.preload(biaGlb);
