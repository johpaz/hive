/**
 * El arnés del benchmark de compactación (bench/compaction): escenarios reproducibles, puntuación
 * y variantes bien conectadas. No llama a ningún modelo real.
 */

import { describe, test, expect } from "bun:test";
import { buildScenario } from "../bench/compaction/scenario";
import { hasAll, norm, scoreRetention } from "../bench/compaction/score";
import { VARIANTS, type Llm } from "../bench/compaction/variants";
import { fakeLlm, probe } from "../bench/compaction/llm";

describe("buildScenario", () => {
  test("es reproducible por semilla y distinto entre semillas", () => {
    const a = buildScenario(7);
    const b = buildScenario(7);
    const c = buildScenario(8);
    expect(a.messages).toEqual(b.messages);
    expect(a.items.map((i) => i.text)).not.toEqual(c.items.map((i) => i.text));
  });

  test("planta cada dato en su sitio, con el rol correcto y fuera del último tramo", () => {
    const s = buildScenario(1, { segments: 4, messagesPerSegment: 30 });
    expect(s.messages.length).toBe(120);
    expect(s.messages.every((m, i) => m.id === i + 1 && m.role === (i % 2 === 0 ? "user" : "assistant"))).toBe(true);
    expect(new Set(s.items.map((i) => i.messageIndex)).size).toBe(s.items.length);
    for (const item of s.items) {
      expect(item.messageIndex).toBeGreaterThanOrEqual(item.segment * 30);
      expect(item.messageIndex).toBeLessThan((item.segment + 1) * 30);
      expect(item.segment).toBeLessThan(3);
      expect(s.messages[item.messageIndex]!.content).toContain(item.text);
      if (item.kind === "preference") expect(s.messages[item.messageIndex]!.role).toBe("user");
    }
  });

  test("lo plantado cumple su propia expectativa", () => {
    const s = buildScenario(3);
    for (const item of s.items) expect(hasAll(s.messages[item.messageIndex]!.content, item.expect)).toBe(true);
  });
});

describe("puntuación", () => {
  test("norm ignora tildes, mayúsculas y espacios", () => {
    expect(norm("  Nota   CRÉDITO ")).toBe("nota credito");
  });

  test("hasAll: todos los grupos, y en cada uno basta una alternativa", () => {
    expect(hasAll("Tono formal, nada de emojis", [["formal"], ["emoji", "emoticon"]])).toBe(true);
    expect(hasAll("Tono formal", [["formal"], ["emoji", "emoticon"]])).toBe(false);
    expect(hasAll("sin emoticonos y formal", [["formal"], ["emoji", "emoticon"]])).toBe(true);
  });

  test("scoreRetention solo cuenta lo que ya pasó por la compactación", () => {
    const s = buildScenario(1);
    const cut = s.segmentEnds[1]!;
    const todo = s.items.map((i) => i.text).join(" ");
    const r = scoreRetention(todo, s.items, cut, (item) => hasAll(todo, item.expect));
    expect(r.considered).toBe(s.items.filter((i) => i.messageIndex < cut).length);
    expect(r.considered).toBeLessThan(s.items.length);
    expect(r.rate).toBe(1);
    expect(scoreRetention("nada", s.items, cut).rate).toBe(0);
  });
});

describe("variantes", () => {
  const scenario = buildScenario(1, { segments: 4, messagesPerSegment: 30 });
  const byName = Object.fromEntries(VARIANTS.map((v) => [v.name, v]));

  test("hay cuatro variantes con nombres distintos", () => {
    expect(VARIANTS.map((v) => v.name)).toEqual(["legacy", "legacy-incremental", "handoff-v1", "handoff"]);
  });

  test("handoff-v1 conserva el prompt de la primera versión y handoff trae las reglas de conservación", async () => {
    const prompts: Record<string, string> = {};
    for (const name of ["handoff-v1", "handoff"]) {
      await byName[name]!.run(scenario, async (_s, user) => {
        prompts[name] ??= user;
        return JSON.stringify({ objective: "x", facts: ["a"], changes: [], verification: [], dead_ends: [], plan: [] });
      });
    }
    expect(prompts["handoff-v1"]).not.toContain("Rules:");
    expect(prompts["handoff"]).toContain("Rules:");
    expect(prompts["handoff"]).toContain("DECLARED as configuration");
    expect(prompts["handoff"]).toContain("never drop a fact");
  });

  test("legacy olvida lo antiguo: la última llamada solo ve los últimos 30 mensajes", async () => {
    const prompts: string[] = [];
    const llm: Llm = async (_s, user) => {
      prompts.push(user);
      return "resumen";
    };
    await byName["legacy"]!.run(scenario, llm);

    const token = scenario.items.find((i) => i.id === "token")!;
    expect(prompts.length).toBe(4);
    expect(prompts[prompts.length - 1]).not.toContain(token.text);
    expect(prompts[0]).toContain(token.text.slice(0, 20));
  });

  test("handoff e incremental pasan el resumen anterior y solo lo nuevo", async () => {
    for (const name of ["legacy-incremental", "handoff"]) {
      const prompts: string[] = [];
      const llm: Llm = async (_s, user) => {
        prompts.push(user);
        return name === "handoff"
          ? JSON.stringify({ objective: "PREVIO-OK", facts: ["hecho"], changes: [], verification: [], dead_ends: [], plan: [] })
          : "PREVIO-OK resumen";
      };
      const run = await byName[name]!.run(scenario, llm);
      expect(prompts.length).toBe(4);
      expect(prompts[0]).not.toContain("PREVIO-OK");
      expect(prompts[1]).toContain("PREVIO-OK");
      expect(run.summary).toContain("PREVIO-OK");
      expect(run.finalCutIndex).toBeGreaterThan(100);
      expect(run.failures).toBe(0);
    }
  });

  test("handoff con JSON roto no compacta y lo cuenta como fallo; con prosa la acepta", async () => {
    const roto = await byName["handoff"]!.run(scenario, async () => '{"objective": "x"');
    expect(roto.failures).toBe(4);
    expect(roto.summary).toBe("");

    const prosa = await byName["handoff"]!.run(scenario, async () => "El usuario migra la facturación.");
    expect(prosa.failures).toBe(0);
    expect(prosa.summary).toBe("El usuario migra la facturación.");
  });

  test("un error del modelo cuenta como fallo y conserva el último resumen bueno", async () => {
    let n = 0;
    const llm: Llm = async () => {
      if (++n === 3) throw new Error("429");
      return "resumen " + n;
    };
    const run = await byName["legacy-incremental"]!.run(scenario, llm);
    expect(run.failures).toBe(1);
    expect(run.calls).toBe(4);
    expect(run.summary).toBe("resumen 4");
  });
});

describe("probe", () => {
  test("acierta solo lo que el resumen contiene", async () => {
    const s = buildScenario(1);
    const items = s.items.slice(0, 3);
    const answers = await probe(fakeLlm(), items[0]!.text, items);
    expect(answers(items[0]!)).toBe(true);
    expect(answers(items[1]!)).toBe(false);
  });

  test("una respuesta ilegible cuenta como fallo", async () => {
    const s = buildScenario(1);
    const answers = await probe(async () => "no es json", "resumen", s.items.slice(0, 2));
    expect(answers(s.items[0]!)).toBe(false);
  });
});

describe("CLI", () => {
  const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

  test("sin clave en la configuración de hive termina con error claro", async () => {
    // Base y directorio efímeros y llave maestra por entorno: no toca el llavero ni ~/.hive.
    const proc = Bun.spawn(["bun", "bench/compaction/run.ts", "--provider", "gemini"], {
      env: { ...base, HIVE_DB_PATH: ":memory:", HIVE_HOME: "/tmp/hive-bench-test", HIVE_MASTER_KEY: "x".repeat(32) },
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir + "/..",
    });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(err).toContain("no tiene clave");
  });

  test("--fake corre la tubería completa y avisa de que los números no valen", async () => {
    const proc = Bun.spawn(["bun", "bench/compaction/run.ts", "--fake", "--seeds", "1"], {
      env: base,
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir + "/..",
    });
    const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(out).toContain("MODELO FALSO");
    expect(out).toContain("| handoff |");
  });
});
