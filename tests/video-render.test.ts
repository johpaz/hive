import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REEL_STYLE, buildOverlayAss, burnOverlays, effectiveTransition, groupWords, joinWithTransitions, normalizeGraphic, normalizeReelStyle,
  normalizeSubtitleStyle, sceneStarts, type OverlaySpec,
} from "../packages/core/src/video/render";
import { parseScriptJson } from "../packages/core/src/video/ai-writer";

const words = [
  { text: "¿La", start: 0.5, end: 0.7 }, { text: "IA", start: 0.8, end: 1 }, { text: "te", start: 1.1, end: 1.2 }, { text: "quita", start: 1.3, end: 1.6 },
  { text: "el", start: 1.7, end: 1.8 }, { text: "trabajo?", start: 1.9, end: 2.4 },
];
const spec = (over: Partial<OverlaySpec> = {}): OverlaySpec => ({
  total: 6, subtitles: DEFAULT_REEL_STYLE.subtitles, graphics: { enabled: true, accent: "#2563EB", progress_bar: false },
  scenes: [{ start: 0, duration: 3, words }, { start: 2.6, duration: 3.4, words: [] }], ...over,
});
const events = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

describe("normalización del acabado", () => {
  test("estilos de subtítulos: valores válidos, colores en mayúsculas y respaldo al predeterminado", () => {
    expect(normalizeSubtitleStyle(null)).toEqual(DEFAULT_REEL_STYLE.subtitles);
    expect(normalizeSubtitleStyle({ preset: "pop", size: "l", color: "#abcdef", highlight: "#00ff00", font: "serif", position: "top", uppercase: true }))
      .toEqual({ preset: "pop", size: "l", color: "#ABCDEF", highlight: "#00FF00", font: "serif", position: "top", uppercase: true });
    expect(normalizeSubtitleStyle({ preset: "x" as never, color: "rojo", highlight: "#12345", position: "izq" as never, size: "xl" as never, font: "comic" as never }))
      .toEqual(DEFAULT_REEL_STYLE.subtitles);
  });
  test("transición y gráficos", () => {
    expect(normalizeReelStyle(null)).toEqual(DEFAULT_REEL_STYLE);
    expect(normalizeReelStyle({ transition: { type: "circleopen", duration: 0.7 } }).transition).toEqual({ type: "circleopen", duration: 0.7 });
    expect(normalizeReelStyle({ transition: { type: "none", duration: 50 } }).transition.duration).toBe(1);
    expect(normalizeReelStyle({ transition: { duration: 0 } }).transition.duration).toBe(0.2);
    expect(normalizeReelStyle({ graphics: { accent: "azul", progress_bar: true } }).graphics).toEqual({ enabled: true, accent: "#2563EB", progress_bar: true });
  });
  test("normalizeGraphic exige tipo y texto y quita lo que rompería el ASS", () => {
    expect(normalizeGraphic({ kind: "title", text: "  Hola {mundo}\n ", sub: "x" })).toEqual({ kind: "title", text: "Hola mundo", sub: "x" });
    expect(normalizeGraphic({ kind: "stat", text: "" })).toEqual({ kind: "none", text: "", sub: "" });
    expect(normalizeGraphic({ kind: "raro" as never, text: "a" })).toEqual({ kind: "none", text: "", sub: "" });
    expect(normalizeGraphic({ kind: "cta", text: "x".repeat(200) }).text).toHaveLength(60);
    expect(normalizeGraphic(undefined)).toEqual({ kind: "none", text: "", sub: "" });
  });
  test("transiciones: el solape se acota y las escenas empiezan descontándolo", () => {
    expect(effectiveTransition({ type: "none", duration: 0.5 }, [4, 4])).toBe(0);
    expect(effectiveTransition({ type: "fade", duration: 0.5 }, [4])).toBe(0);
    expect(effectiveTransition({ type: "fade", duration: 1 }, [4, 2, 4])).toBeCloseTo(0.8); // 40 % de la escena más corta
    expect(sceneStarts([4, 3, 3], 0.5)).toEqual([0, 3.5, 6]);
    expect(sceneStarts([4, 3, 3], 0)).toEqual([0, 4, 7]);
  });
  test("groupWords corta en la puntuación y en 4 palabras", () => {
    expect(groupWords(words).map((g) => g.map((w) => w.text).join(" "))).toEqual(["¿La IA te quita", "el trabajo?"]);
  });
});

describe("archivo ASS", () => {
  const dims = { width: 720, height: 1280 };
  test("clásico: una línea por grupo, desplazada por el inicio de la escena", () => {
    const ev = events(buildOverlayAss(spec({ scenes: [{ start: 2, duration: 3, words }] }), dims));
    expect(ev).toHaveLength(2);
    expect(ev[0]).toContain("0:00:02.50,"); // 2 s de la escena + 0,5 s de la primera palabra
    expect(ev[0]).toContain(",Sub,,0,0,0,,¿La IA te quita");
  });
  test("karaoke: una línea por palabra con la activa en el color de resalte", () => {
    const ev = events(buildOverlayAss(spec({ subtitles: { ...DEFAULT_REEL_STYLE.subtitles, preset: "karaoke", highlight: "#FF0000" } }), dims));
    expect(ev.length).toBe(6);
    expect(ev[1]).toContain("{\\c&H000000FF}IA{\\c&H00FFFFFF}"); // ASS usa BGR: rojo = 0000FF
    expect(ev[0]).toContain("{\\c&H000000FF}¿La");
  });
  test("pop y mayúsculas", () => {
    const pop = events(buildOverlayAss(spec({ subtitles: { ...DEFAULT_REEL_STYLE.subtitles, preset: "pop" } }), dims));
    expect(pop[0]).toContain("\\fscx70");
    expect(pop[0]).toContain("¿LA IA TE QUITA");
    const up = events(buildOverlayAss(spec({ subtitles: { ...DEFAULT_REEL_STYLE.subtitles, uppercase: true } }), dims));
    expect(up[0]).toContain("EL TRABAJO?".length ? "¿LA IA TE QUITA" : "");
  });
  test("caja: BorderStyle 3; posición: alineación 2, 5 u 8", () => {
    const box = buildOverlayAss(spec({ subtitles: { ...DEFAULT_REEL_STYLE.subtitles, preset: "box" } }), dims);
    expect(box).toMatch(/Style: Sub,[^\n]*,0,0,3,\d+,/); // …,Angle,BorderStyle=3
    for (const [pos, al] of [["bottom", 2], ["middle", 5], ["top", 8]] as const) {
      expect(buildOverlayAss(spec({ subtitles: { ...DEFAULT_REEL_STYLE.subtitles, position: pos } }), dims)).toMatch(new RegExp(`Style: Sub,[^\\n]*,${al},\\d+,\\d+,\\d+,1\\n`));
    }
  });
  test("sin subtítulos no hay líneas de diálogo del habla", () => {
    expect(events(buildOverlayAss(spec({ subtitles: null }), dims))).toHaveLength(0);
  });
  test("gráficos: cada tipo dibuja su evento con su estilo, y se desactivan en bloque", () => {
    const graphic = (kind: any, text: string, sub = "") => spec({ subtitles: null, scenes: [{ start: 1, duration: 5, words: [], graphic: { kind, text, sub } }] });
    expect(events(buildOverlayAss(graphic("title", "El gancho"), dims))[0]).toMatch(/,GTitle,.*El gancho/);
    const lt = events(buildOverlayAss(graphic("lower_third", "Ana García", "Directora"), dims));
    expect(lt.map((l) => l.split(",")[3])).toEqual(["GName", "GRole"]);
    const st = events(buildOverlayAss(graphic("stat", "73 %", "de los empleos"), dims));
    expect(st.map((l) => l.split(",")[3])).toEqual(["GStat", "GStatLabel"]);
    expect(events(buildOverlayAss(graphic("cta", "Comenta"), dims))[0]).toMatch(/,GCta,.*Comenta {2}➜/);
    expect(events(buildOverlayAss({ ...graphic("title", "x"), graphics: { enabled: false, accent: "#2563EB", progress_bar: true } }, dims))).toHaveLength(0);
  });
  test("barra de progreso: un rectángulo que crece durante todo el reel", () => {
    const ev = events(buildOverlayAss(spec({ subtitles: null, scenes: [], graphics: { enabled: true, accent: "#2563EB", progress_bar: true } }), dims));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toContain("\\fscx0\\t(0,6000,\\fscx100)");
    expect(ev[0]).toContain("m 0 0 l 720 0");
  });
  test("el color de acento va en BGR y el tamaño escala con el alto del video", () => {
    const a = buildOverlayAss(spec({ graphics: { enabled: true, accent: "#10B981", progress_bar: false } }), dims);
    expect(a).toContain("&H0081B910"); // #10B981 → BGR
    const small = buildOverlayAss(spec(), { width: 360, height: 640 });
    expect(small).toContain("PlayResX: 360");
    expect(Number(/Style: Sub,[^,]*,(\d+),/.exec(small)![1])).toBeLessThan(Number(/Style: Sub,[^,]*,(\d+),/.exec(a)![1]));
  });
});

describe("guion con gráficos", () => {
  test("el guionista devuelve el gráfico normalizado de cada escena", () => {
    const people = [{ id: "ana", name: "Ana" }];
    const raw = JSON.stringify({ script: "G", scenes: [
      { seconds: 5, prompt: "a", wardrobe: "x", setting: "y", dialogue: "Hola", character_ids: ["ana"], graphic: { kind: "title", text: "¿Te quita el trabajo?", sub: "" } },
      { seconds: 5, prompt: "b", wardrobe: "x", setting: "y", dialogue: "", character_ids: ["ana"], graphic: { kind: "raro", text: "z" } },
      { seconds: 5, prompt: "c", wardrobe: "x", setting: "y", dialogue: "", character_ids: ["ana"] },
    ] });
    const r = parseScriptJson(raw, { target_seconds: 15, characters_detail: people });
    expect(r.scenes[0].graphic).toEqual({ kind: "title", text: "¿Te quita el trabajo?", sub: "" });
    expect(r.scenes[1].graphic.kind).toBe("none");
    expect(r.scenes[2].graphic.kind).toBe("none");
  });
});

describe("ffmpeg real", () => {
  const run = (args: string[]) => expect(Bun.spawnSync(["ffmpeg", "-v", "error", "-y", ...args]).exitCode).toBe(0);
  const dur = (p: string) => Number(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).stdout.toString());
  test.skipIf(!Bun.which("ffmpeg"))("une con transición (duración = suma − solape), conserva el audio y graba subtítulos y gráficos", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-render-"));
    try {
      const clips = ["a", "b"].map((n) => join(dir, `${n}.mp4`));
      clips.forEach((c, i) => run(["-f", "lavfi", "-i", `color=c=${i ? "blue" : "red"}:s=180x320:d=3:r=24`, "-f", "lavfi", "-i", "sine=frequency=440:d=3", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", c]));
      const joined = await joinWithTransitions(clips, [3, 3], { type: "slideleft", duration: 0.5 });
      await Bun.write(join(dir, "joined.mp4"), joined);
      expect(dur(join(dir, "joined.mp4"))).toBeCloseTo(5.5, 1);
      const streams = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", join(dir, "joined.mp4")]).stdout.toString();
      expect(streams).toContain("audio");
      const out = await burnOverlays(joined, {
        total: 5.5, subtitles: { ...DEFAULT_REEL_STYLE.subtitles, preset: "karaoke" }, graphics: { enabled: true, accent: "#2563EB", progress_bar: true },
        scenes: [{ start: 0, duration: 3, words, graphic: { kind: "title", text: "Hola", sub: "" } }, { start: 2.5, duration: 3, words: [], graphic: { kind: "cta", text: "Comenta", sub: "" } }],
      });
      await Bun.write(join(dir, "out.mp4"), out);
      expect(dur(join(dir, "out.mp4"))).toBeCloseTo(5.5, 1);
      expect(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", join(dir, "out.mp4")]).stdout.toString()).toContain("audio");
      // el video cambió (los gráficos están dibujados): el fotograma a 1 s ya no es el rojo liso
      const frame = (f: string) => Bun.spawnSync(["ffmpeg", "-v", "error", "-ss", "1", "-i", f, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]).stdout.byteLength;
      expect(frame(join(dir, "out.mp4"))).toBeGreaterThan(frame(join(dir, "joined.mp4")));
      await expect(joinWithTransitions(clips, [3, 3], { type: "none", duration: 0.5 })).rejects.toThrow(/No hay transición/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
