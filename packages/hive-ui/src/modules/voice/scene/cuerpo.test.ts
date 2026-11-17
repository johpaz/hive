import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { Bone, Euler, Object3D, Quaternion, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CuerpoRig, HUESOS, poseCuerpo, type EntradaCuerpo } from "./cuerpo";

const manos = { izq: { mano: 0, dedos: 0, abre: 0, muneca: 0 }, der: { mano: 0, dedos: 0, abre: 0, muneca: 0 } };
const base: EntradaCuerpo = { t: 3, estado: "reposo", voz: 0, mic: 0, onset: 0, piensa: 0, exito: 0, alerta: 0, manos };

describe("poseCuerpo", () => {
  test("devuelve un giro finito para cada hueso", () => {
    const p = poseCuerpo({ ...base, voz: 1, onset: 1, piensa: 1, exito: 1, alerta: 1 });
    for (const h of HUESOS) for (const v of p[h]) expect(Number.isFinite(v)).toBe(true);
  });
  test("pensando ladea y gira la cabeza; en reposo casi no", () => {
    const quieto = poseCuerpo(base).head;
    const piensa = poseCuerpo({ ...base, piensa: 1 }).head;
    expect(Math.abs(piensa[1])).toBeGreaterThan(Math.abs(quieto[1]) + 0.05);
    expect(piensa[2]).toBeGreaterThan(quieto[2] + 0.02);
  });
  test("celebrar aletea: las alas se mueven en sentidos opuestos", () => {
    const p = poseCuerpo({ ...base, t: 0.17, exito: 1 });
    expect(Math.abs(p.wing_L[2])).toBeGreaterThan(0.05);
    expect(Math.sign(p.wing_L[2])).toBe(-Math.sign(p.wing_R[2]));
  });
  test("el ademán de una mano sube su antebrazo, no el del otro lado", () => {
    const p = poseCuerpo({ ...base, manos: { ...manos, izq: { ...manos.izq, mano: 1 } } });
    const q = poseCuerpo(base);
    expect(p.forearm_L[2] - q.forearm_L[2]).toBeGreaterThan(0.25);
    expect(Math.abs(p.forearm_R[2] - q.forearm_R[2])).toBeLessThan(1e-9);
  });
});

describe("CuerpoRig", () => {
  test("un giro en ejes del modelo queda igual aunque el hueso esté rotado en reposo", () => {
    const raiz = new Object3D();
    const padre = new Bone(); padre.name = "spine";
    const hijo = new Bone(); hijo.name = "chest";
    padre.quaternion.setFromEuler(new Euler(0.4, 0.9, -0.3));
    hijo.quaternion.setFromEuler(new Euler(-0.7, 0.2, 1.1));
    padre.add(hijo); raiz.add(padre);
    const rig = new CuerpoRig(raiz);
    expect(rig.cantidad).toBe(2);

    const restoMundo = hijo.getWorldQuaternion(new Quaternion());
    const pose = Object.fromEntries(HUESOS.map((h) => [h, [0, 0, 0]])) as ReturnType<typeof poseCuerpo>;
    pose.chest = [0.3, 0, 0];
    rig.aplicar(pose);
    raiz.updateMatrixWorld(true);

    const esperado = new Quaternion().setFromEuler(new Euler(0.3, 0, 0)).multiply(restoMundo);
    expect(hijo.getWorldQuaternion(new Quaternion()).angleTo(esperado)).toBeLessThan(1e-6);

    // sin giro vuelve al reposo exacto
    rig.aplicar(Object.fromEntries(HUESOS.map((h) => [h, [0, 0, 0]])) as ReturnType<typeof poseCuerpo>);
    raiz.updateMatrixWorld(true);
    expect(hijo.getWorldQuaternion(new Quaternion()).angleTo(restoMundo)).toBeLessThan(1e-6);
  });

  test("el GLB real trae los 14 huesos, esqueleto y shape keys", async () => {
    const buf = readFileSync(new URL("../../../assets/bia.glb", import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    // las texturas necesitan DOM/`self`; esta prueba solo mira esqueleto y morphs
    const loader = new GLTFLoader();
    loader.register((parser) => {
      (parser as unknown as { loadTexture: () => Promise<null> }).loadTexture = async () => null;
      return { name: "sin_texturas" };
    });
    const gltf = await new Promise<{ scene: Object3D }>((ok, mal) =>
      loader.parse(ab as ArrayBuffer, "", ok as never, mal),
    );
    const copia = clone(gltf.scene);
    expect(new CuerpoRig(copia).cantidad).toBe(HUESOS.length);
    let skinned = 0, morphs = 0;
    copia.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) {
        skinned++;
        const dic = (o as SkinnedMesh).morphTargetDictionary;
        if (dic) { morphs += Object.keys(dic).length; for (const k of ["brow_up", "jaw_open", "blink_L", "mano_izq"]) expect(dic[k]).toBeDefined(); }
      }
    });
    expect(skinned).toBe(4);
    expect(morphs).toBeGreaterThanOrEqual(33);
  });
});
