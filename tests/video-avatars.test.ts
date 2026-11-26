process.env.HIVE_DB_PATH = ":memory:";

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import { deleteProviderApiKey } from "../packages/core/src/storage/crypto";
import { AvatarError, deleteAvatar, getAvatar, listAvatars, renameAvatar, upsertAvatar } from "../packages/core/src/video/avatars";
import { applyAvatar, backfillAvatars, createProject, getProject, setCharacterFace, updateProject } from "../packages/core/src/video/studio";
import { handleVideoAvatars, handleVideoProjects } from "../packages/core/src/gateway/routes/video";
import { videoAvatarListTool, videoProjectCreateTool } from "../packages/core/src/tools/video/index";
import type { ArtifactDoc } from "../packages/core/src/storage/collections";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 3)]);
const realSecrets = (Bun as any).secrets;
const prevOut = process.env.HIVE_OUTPUT_DIR;
const cors = (r: Response) => r;
let out: string;

beforeEach(async () => {
  (Bun as any).secrets = { get: async () => null, set: async () => {}, delete: async () => false };
  closeHiveDb();
  await ensureHiveDb();
  await deleteProviderApiKey("gemini");
  out = mkdtempSync(join(tmpdir(), "hive-avatars-"));
  process.env.HIVE_OUTPUT_DIR = out;
});
afterEach(() => {
  (Bun as any).secrets = realSecrets;
  if (prevOut === undefined) delete process.env.HIVE_OUTPUT_DIR; else process.env.HIVE_OUTPUT_DIR = prevOut;
  rmSync(out, { recursive: true, force: true });
});

/** Un reel con un personaje que ya subió su rostro. `seed` cambia los bytes: fotos distintas = personas distintas. */
async function uploadedHero(userId = "u1", name = "Ana", seed = 3) {
  const p = await createProject({ userId, title: "Primero", targetSeconds: 6 });
  const withChar = await updateProject(p.id, { characters: [{ name, description: "presentadora" }] });
  const cid = withChar.characters[0].id;
  const bytes = seed === 3 ? PNG : Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, seed)]);
  const done = await setCharacterFace(p.id, cid, { bytes: new Uint8Array(bytes), consent: true });
  return { projectId: p.id, cid, project: done };
}

describe("Mis avatares", () => {
  test("subir un rostro lo guarda en la biblioteca con su nombre, sin duplicar y sin copiar el archivo", async () => {
    const { project } = await uploadedHero();
    const list = await listAvatars("u1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ana", description: "presentadora", face_artifact_id: project.characters[0].face_artifact_id, available: true });
    expect(list[0].face_path).toBe(project.characters[0].face_path);
    expect(list[0].face_path.startsWith(join(out, "estudio-videos", "imagenes"))).toBe(true);
    // no hay un segundo archivo: la biblioteca solo apunta a la foto
    const artifacts = await (await col<ArtifactDoc>("artifacts")).scan({});
    expect(artifacts.filter((a) => a.doc.kind === "uploaded_image")).toHaveLength(1);
  });

  test("la misma foto subida en varios reels es UN avatar (se identifica por su contenido)", async () => {
    const first = await uploadedHero("u5", "Ana");
    const second = await uploadedHero("u5", "Ana de nuevo"); // mismos bytes, otro reel, otro archivo
    expect(second.project.characters[0].face_artifact_id).not.toBe(first.project.characters[0].face_artifact_id);
    const list = await listAvatars("u5");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Ana de nuevo");                              // el último nombre elegido
    expect(list[0].face_path).toBe(first.project.characters[0].face_path);  // conserva el primer archivo
    // otra foto distinta sí es otro avatar
    const p = await createProject({ userId: "u5", title: "Otra persona" });
    const c = await updateProject(p.id, { characters: [{ name: "Luis", description: "" }] });
    await setCharacterFace(p.id, c.characters[0].id, { bytes: new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 9)])), consent: true });
    expect(await listAvatars("u5")).toHaveLength(2);
  });

  test("el nombre y la voz que se elijan después actualizan el mismo avatar", async () => {
    const { projectId, cid } = await uploadedHero();
    await updateProject(projectId, { characters: [{ id: cid, name: "Ana Pérez", description: "presentadora", voice_id: "voz-ana", voice_name: "Ana clonada", voice_settings: { stability: 1, volume: 1.3 } }] });
    const list = await listAvatars("u1");
    expect(list).toHaveLength(1); // se actualizó, no se duplicó
    expect(list[0]).toMatchObject({ name: "Ana Pérez", voice_id: "voz-ana", voice_name: "Ana clonada" });
    expect(list[0].voice_settings).toMatchObject({ stability: 1, volume: 1.3, mode: "sync" });
  });

  test("sin consentimiento o sin foto no se guarda nada", async () => {
    expect(await upsertAvatar("u1", { name: "X", description: "", face_artifact_id: "a", face_path: "/x", face_consent: false, voice_id: null, voice_name: null, voice_settings: {} as never })).toBeNull();
    expect(await upsertAvatar("u1", { name: "X", description: "", face_artifact_id: null, face_path: null, face_consent: true, voice_id: null, voice_name: null, voice_settings: {} as never })).toBeNull();
    expect(await listAvatars("u1")).toHaveLength(0);
  });

  test("un reel nuevo empieza con el avatar: rostro y voz sin volver a subir nada", async () => {
    const { projectId, cid } = await uploadedHero();
    await updateProject(projectId, { characters: [{ id: cid, name: "Ana", description: "presentadora", voice_id: "voz-ana", voice_name: "Ana clonada" }] });
    const [avatar] = await listAvatars("u1");
    const before = (await (await col<ArtifactDoc>("artifacts")).scan({})).length;
    const reel = await createProject({ userId: "u1", title: "Segundo reel", avatarId: avatar.id });
    expect(reel.characters).toHaveLength(1);
    expect(reel.characters[0]).toMatchObject({ name: "Ana", description: "presentadora", face_consent: true, voice_id: "voz-ana", voice_name: "Ana clonada" });
    expect(reel.characters[0].face_path).toBe(avatar.face_path);
    expect((await (await col<ArtifactDoc>("artifacts")).scan({})).length).toBe(before); // ni una foto nueva
    expect(await listAvatars("u1")).toHaveLength(1);
  });

  test("aplicar a un personaje existente respeta el nombre que el usuario ya escribió y reemplaza el provisional", async () => {
    const { projectId } = await uploadedHero("u1", "Ana");
    const [avatar] = await listAvatars("u1");
    const p = await createProject({ userId: "u1", title: "Otro" });
    const withChars = await updateProject(p.id, { characters: [{ name: "Protagonista", description: "" }, { name: "Luis", description: "invitado" }] });
    const [prov, luis] = withChars.characters;
    const a = await applyAvatar(p.id, avatar.id, prov.id);
    expect(a.characters[0]).toMatchObject({ name: "Ana", face_consent: true });
    const b = await applyAvatar(p.id, avatar.id, luis.id);
    expect(b.characters[1].name).toBe("Luis"); // el nombre elegido se conserva
    expect(b.characters[1].face_path).toBe(avatar.face_path);
    expect(projectId).toBeTruthy();
  });

  test("al aplicar se invalidan los clips del personaje que cambió de cara", async () => {
    const { projectId } = await uploadedHero();
    const [avatar] = await listAvatars("u1");
    const p = await createProject({ userId: "u1", title: "Con escenas" });
    const c = await updateProject(p.id, { characters: [{ name: "Protagonista", description: "" }] });
    const done = await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "x", character_ids: [c.characters[0].id] }] });
    expect(done.scenes[0].status).toBe("pending");
    const applied = await applyAvatar(p.id, avatar.id, c.characters[0].id);
    expect(applied.approved_cost_usd).toBeNull();
    expect(projectId).toBeTruthy();
  });

  test("si la foto ya no está en el disco se avisa y el proyecto no se crea a medias", async () => {
    const { project } = await uploadedHero();
    const [avatar] = await listAvatars("u1");
    rmSync(project.characters[0].face_path!);
    expect((await listAvatars("u1"))[0].available).toBe(false);
    const before = (await (await col<any>("videoProjects")).scan({})).length;
    await expect(createProject({ userId: "u1", title: "Roto", avatarId: avatar.id })).rejects.toThrow(/ya no está en tu carpeta/);
    expect((await (await col<any>("videoProjects")).scan({})).length).toBe(before);
    await expect(createProject({ userId: "u1", title: "Nada", avatarId: "no-existe" })).rejects.toBeInstanceOf(AvatarError);
  });

  test("quitar un avatar de la biblioteca no borra la foto; renombrar valida", async () => {
    const { project } = await uploadedHero();
    const [avatar] = await listAvatars("u1");
    const renamed = await renameAvatar(avatar.id, { name: "  Ana Directora  " });
    expect(renamed.name).toBe("Ana Directora");
    await expect(renameAvatar(avatar.id, { name: "   " })).rejects.toThrow(/necesita un nombre/);
    await deleteAvatar(avatar.id);
    expect(await listAvatars("u1")).toHaveLength(0);
    expect(existsSync(project.characters[0].face_path!)).toBe(true);
    await expect(getAvatar(avatar.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteAvatar(avatar.id)).rejects.toMatchObject({ code: "not_found" });
  });

  test("cada usuario ve solo sus avatares y no puede aplicar los de otro", async () => {
    await uploadedHero("u1", "Ana");
    const [avatar] = await listAvatars("u1");
    expect(await listAvatars("u2")).toHaveLength(0);
    const p = await createProject({ userId: "u2", title: "Ajeno" });
    await expect(applyAvatar(p.id, avatar.id)).rejects.toThrow(/no es de este usuario/);
  });
});

describe("rostros subidos antes de la biblioteca", () => {
  test("se recogen una sola vez, sin duplicar, y respetan el consentimiento y la foto en disco", async () => {
    // reels antiguos: el rostro está en el proyecto pero nunca pasó por la biblioteca
    const a = await uploadedHero("u9", "Vieja", 11);
    await deleteAvatar((await listAvatars("u9"))[0].id);           // como si nunca se hubiera guardado
    const b = await uploadedHero("u9", "Nueva", 12);
    await deleteAvatar((await listAvatars("u9"))[0].id);
    expect(await listAvatars("u9")).toHaveLength(0);
    // un tercer reel cuya foto ya no existe en disco
    const c = await uploadedHero("u9", "Sin foto", 13);
    await deleteAvatar((await listAvatars("u9"))[0].id);
    rmSync(c.project.characters[0].face_path!);
    expect(await backfillAvatars("u9")).toBe(2);
    const list = await listAvatars("u9");
    expect(list.map((x) => x.name).sort()).toEqual(["Nueva", "Vieja"]);
    expect(await backfillAvatars("u9")).toBe(0);                    // idempotente: ya corrió
    expect(await listAvatars("u9")).toHaveLength(2);
    expect(a.project.characters[0].face_path).toBeTruthy();
    expect(b.project.characters[0].face_path).toBeTruthy();
  });
});

describe("rutas y tools de avatares", () => {
  test("REST: listar, renombrar, aplicar a un proyecto y quitar", async () => {
    const { project } = await uploadedHero("u1");
    // las rutas resuelven el usuario único de la base; se crea uno con el mismo id que usan estas pruebas
    await (await col<any>("users")).put("u1", { id: "u1", name: "Test", email: null });
    const req = (path: string, method = "GET", body?: unknown) => new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
    const list = await (await handleVideoAvatars(req("/api/video/avatars"), cors))!.json() as any;
    expect(list.avatars).toHaveLength(1);
    expect(list.avatars[0].available).toBe(true);
    const id = list.avatars[0].id;
    expect(((await (await handleVideoAvatars(req(`/api/video/avatars/${id}`, "PATCH", { name: "Ana B" }), cors))!.json()) as any).avatar.name).toBe("Ana B");

    const created = await (await handleVideoProjects(req("/api/video/projects", "POST", { title: "Por REST", avatar_id: id }), cors))!.json() as any;
    expect(created.project.characters[0]).toMatchObject({ name: "Ana B", face_path: project.characters[0].face_path });
    const applied = await handleVideoProjects(req(`/api/video/projects/${created.project.id}/avatars/${id}?character=${created.project.characters[0].id}`, "POST"), cors);
    expect(applied!.status).toBe(200);
    expect((await handleVideoProjects(req(`/api/video/projects/${created.project.id}/avatars/no-existe`, "POST"), cors))!.status).toBe(404);
    expect((await handleVideoAvatars(req(`/api/video/avatars/${id}`, "DELETE"), cors))!.status).toBe(200);
    expect((await handleVideoAvatars(req(`/api/video/avatars/${id}`, "DELETE"), cors))!.status).toBe(404);
    expect(await handleVideoAvatars(req("/api/video/otra"), cors)).toBeNull();
    expect((await getProject(created.project.id)).characters).toHaveLength(1);
  });

  test("tools: el Director lista los avatares y crea el reel con avatar_id", async () => {
    const { project } = await uploadedHero("u1");
    const cfg = { configurable: { user_id: "u1" } };
    const listed = await videoAvatarListTool.execute({}, cfg) as any;
    expect(listed.ok).toBe(true);
    expect(listed.avatars).toEqual([{ avatar_id: expect.any(String), name: "Ana", description: "presentadora", voice: null, photo_available: true }]);
    const created = await videoProjectCreateTool.execute({ title: "Desde el Director", avatar_id: listed.avatars[0].avatar_id }, cfg) as any;
    expect(created.ok).toBe(true);
    expect(created.characters[0]).toMatchObject({ name: "Ana", has_face_reference: true });
    expect((await getProject(created.project_id)).characters[0].face_path).toBe(project.characters[0].face_path);
    const empty = await videoAvatarListTool.execute({}, { configurable: { user_id: "otro" } }) as any;
    expect(empty.avatars).toEqual([]);
    expect(empty.hint).toContain("No hay avatares guardados");
  });
});
