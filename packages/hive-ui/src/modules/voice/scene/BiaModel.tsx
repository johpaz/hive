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
 * Meshy no genera rig ni blendshapes, así que los morph targets se crearon a mano
 * en Blender (el original sin tocar está en `bia.original.glb`):
 *  - `mano_izq` / `mano_der`: giro de 30° con caída suave alrededor de cada muñeca.
 *  - Boca: la malla traía los labios sellados y fusionados con la piel, y
 *    separarlos moviendo vértices daba estrías con cualquier amplitud. Se cortó
 *    la malla por la línea de los labios (la comisura queda unida) y detrás hay
 *    tres objetos sueltos —`boca_cavidad`, `boca_lengua`, `boca_dientes`— que se
 *    ven por la abertura. Sobre ese corte van `jaw_open`, `mouth_smile` y los
 *    14 visemas Oculus (`viseme_*`).
 *  - `blink_L` / `blink_R`: aplastan verticalmente la zona de cada ojo; el ojo
 *    pintado queda como una línea de pestañas.
 *
 * Los visemas los calcula HeadAudio a partir del audio de la voz (lib/realtime/
 * lipsync.ts). Sin worklet, la mandíbula sigue la amplitud.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, Group, MathUtils, Mesh, MeshStandardMaterial, PointLight } from "three";
import biaGlb from "@/assets/bia.glb";
import type { PulseRef } from "./audioPulse";
import type { BiaState } from "./BiaPortrait";
import { crearParpadeo, pasoParpadeo, respiracion, ruido } from "./idleLife";
import { DirectorDeGestos } from "./gestures";
import { VisemeTracker } from "@/lib/realtime/lipsync";
import { getLipsyncSource } from "@/stores/realtimeStore";

/** Visemas Oculus que trae el GLB (el de silencio no tiene morph: es la cara neutra). */
const VISEMAS = [
  "viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U",
  "viseme_PP", "viseme_SS", "viseme_TH", "viseme_DD", "viseme_FF",
  "viseme_kk", "viseme_nn", "viseme_RR", "viseme_CH",
] as const;

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
    const encontrados: Array<{
      malla: Mesh;
      boca: number;
      /** Índices [mano, dedos, abre, muneca] de cada mano; -1 si el GLB no los trae. */
      izq: [number, number, number, number];
      der: [number, number, number, number];
      parpadeoIzq: number;
      parpadeoDer: number;
      mandibula: number;
      sonrisa: number;
      visemas: Array<[string, number]>;
    }> = [];
    modelo.traverse((hijo) => {
      const malla = hijo as Mesh;
      if (!malla.isMesh || !malla.morphTargetDictionary || !malla.morphTargetInfluences) return;
      const dic = malla.morphTargetDictionary;
      encontrados.push({
        malla,
        boca: dic["boca_abierta"] ?? -1,
        izq: [dic["mano_izq"] ?? -1, dic["dedos_izq"] ?? -1, dic["abre_izq"] ?? -1, dic["muneca_izq"] ?? -1],
        der: [dic["mano_der"] ?? -1, dic["dedos_der"] ?? -1, dic["abre_der"] ?? -1, dic["muneca_der"] ?? -1],
        parpadeoIzq: dic["blink_L"] ?? -1,
        parpadeoDer: dic["blink_R"] ?? -1,
        mandibula: dic["jaw_open"] ?? -1,
        sonrisa: dic["mouth_smile"] ?? -1,
        visemas: VISEMAS.flatMap((v): Array<[string, number]> => (dic[v] !== undefined ? [[v, dic[v]]] : [])),
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

  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  useEffect(() => {
    // La textura es de 1024 px para todo el cuerpo: la cara ocupa un puñado de
    // píxeles. El filtrado anisotrópico evita que se emborrone cuando la
    // superficie se ve en ángulo (mejilla, hombro, mano).
    for (const m of materiales) {
      for (const tex of [m.map, m.normalMap, m.metalnessMap, m.roughnessMap]) {
        if (tex && tex.anisotropy !== Math.min(8, maxAniso)) {
          tex.anisotropy = Math.min(8, maxAniso);
          tex.needsUpdate = true;
        }
      }
    }
  }, [materiales, maxAniso]);

  useEffect(() => {
    // Emisión propia: el traje es oscuro y sin esto la figura se hunde en el
    // fondo negro de la escena.
    for (const m of materiales) {
      if (m.name.startsWith("boca_")) continue; // el interior de la boca no brilla
      m.emissive = new Color("#20222e");
      m.emissiveIntensity = 0.35;
    }
  }, [materiales]);

  const director = useMemo(() => new DirectorDeGestos(), []);
  const tracker = useMemo(() => new VisemeTracker(), []);
  useEffect(() => () => tracker.detach(), [tracker]);

  const acento = useMemo(() => new Color(COLOR_ESTADO.reposo), []);
  const acentoObjetivo = useMemo(() => new Color(), []);
  const anim = useRef({ voz: 0, mic: 0, live: 0, piensa: 0, sonrisa: 0.14 });
  const parpadeo = useRef(crearParpadeo(0));

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
    a.piensa = MathUtils.damp(a.piensa, working && estado !== "habla" ? 1 : 0, 3, dt);

    if (grupo.current) {
      // Respiración asimétrica (se inhala más rápido de lo que se exhala) y
      // deriva con ruido: sin periodo único el cuerpo no entra en bucle.
      const respira = (respiracion(t) - 0.5) * 0.04 + a.voz * 0.012;
      grupo.current.position.y = -1.02 + respira;
      grupo.current.position.x = ruido(t * 0.5, 1) * 0.035 + ruido(t * 1.6, 2) * 0.006 * a.voz;
      // Sin escalado con la voz: era un recurso de visualizador de audio, no
      // de personaje. La voz se muestra con cabeceo, manos y luz.
      grupo.current.scale.setScalar(1.3);

      // De frente y quieta. Antes acumulaba un ángulo sin fin —más rápido
      // mientras la colmena trabajaba— y acababa dando la espalda a quien le
      // hablaba. Girarla es cosa del ratón; lo único que queda aquí es un
      // apunte mínimo hacia quien habla, que es reacción y no movimiento
      // propio: con el micrófono en silencio vale cero. Pensando, la mirada
      // se desvía un poco y la cabeza se ladea, como quien busca la respuesta.
      grupo.current.rotation.y = a.mic * 0.08 + a.piensa * (0.07 + ruido(t * 0.4, 3) * 0.02);
      // Cabeceo al hablar. Es lo que sustituye al movimiento de labios, así
      // que pesa más de lo que pesaría en un avatar con lip-sync propio.
      grupo.current.rotation.x =
        ruido(t * 1.3, 4) * 0.026 * (0.4 + a.voz * 3.2) +
        ruido(t * 2.7, 5) * 0.008 * a.voz -
        a.piensa * 0.03;
      grupo.current.rotation.z = ruido(t * 0.8, 6) * 0.014 + a.piensa * 0.045;
    }

    const cierre = pasoParpadeo(parpadeo.current, t);

    acentoObjetivo.set(COLOR_ESTADO[estado]);
    acento.lerp(acentoObjetivo, Math.min(1, dt * 4));

    for (const m of materiales) {
      if (m.name.startsWith("boca_")) continue;
      m.emissiveIntensity = 0.3 + a.voz * 0.5 + a.live * 0.15;
    }

    // ── Boca ─────────────────────────────────────────────────────────────
    // Los visemas salen del audio de la voz (HeadAudio). Si no hay worklet, la
    // mandíbula sigue la amplitud, que es peor pero no deja la boca muerta.
    const fuente = getLipsyncSource();
    if (fuente && !tracker.atiende(fuente.context)) void tracker.attach(fuente.context, fuente.node);
    else if (!fuente && tracker.activo) tracker.detach();
    tracker.update(delta * 1000);
    a.sonrisa = MathUtils.damp(
      a.sonrisa,
      estado === "exito" ? 0.7 : estado === "escucha" ? 0.28 : 0.14,
      3,
      dt,
    );

    // ── Gestos ───────────────────────────────────────────────────────────
    // Las manos nunca se quedan quietas —unas manos congeladas delatan a una
    // figura tanto como una boca quieta— pero lo que hacen depende del estado:
    // explicar, escuchar, pensar o celebrar (ver gestures.ts).
    const manos = director.step({ t, estado, voz: a.voz, onset: p.onset, working }, dt);
    for (const m of morphs) {
      const inf = m.malla.morphTargetInfluences;
      if (!inf) continue;
      if (m.boca >= 0) inf[m.boca] = Math.min(1, a.voz * 1.6);
      if (m.mandibula >= 0) inf[m.mandibula] = tracker.activo ? 0 : Math.min(1, a.voz * 1.1);
      if (m.sonrisa >= 0) inf[m.sonrisa] = a.sonrisa;
      for (const [nombre, idx] of m.visemas) {
        inf[idx] = tracker.activo ? Math.min(1, (tracker.values[nombre] ?? 0) * 1.3) : 0;
      }
      if (m.parpadeoIzq >= 0) inf[m.parpadeoIzq] = cierre;
      if (m.parpadeoDer >= 0) inf[m.parpadeoDer] = cierre;
      for (const [lado, pose] of [[m.izq, manos.izq], [m.der, manos.der]] as const) {
        const valores = [pose.mano, pose.dedos, pose.abre, pose.muneca];
        for (let i = 0; i < 4; i++) {
          const idx = lado[i]!;
          if (idx >= 0) inf[idx] = valores[i]!;
        }
      }
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
