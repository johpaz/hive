import { describe, test, expect } from "bun:test";
import { renderHistoryTimeline, packRecall, renderRecall } from "../packages/core/src/agent/history-timeline";
import type { StoredMessage } from "../packages/core/src/agent/conversation-store";

function msg(id: number, role: StoredMessage["role"], content: string, extra: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id, thread_id: "t", channel: "webchat", role, source: "user" as StoredMessage["source"], content,
    tool_calls_json: null, tool_call_id: null, reasoning_content: null, content_multimodal: null,
    token_count: 0, created_at: 0, ...extra,
  };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1, i % 2 ? "assistant" : "user", `mensaje número ${i + 1} con algo de texto de relleno`));

describe("renderHistoryTimeline", () => {
  test("una línea por mensaje, en orden, cuando caben", () => {
    const t = renderHistoryTimeline(many(5), { budgetTokens: 1000 });
    expect(t.ids).toEqual([1, 2, 3, 4, 5]);
    expect(t.text.split("\n")).toHaveLength(5);
    expect(t.text.split("\n")[0]).toContain("#1 [user]");
  });

  test("respeta el presupuesto y conserva el primero y el último", () => {
    const rows = many(200);
    const t = renderHistoryTimeline(rows, { budgetTokens: 150 });
    expect(t.ids.length).toBeLessThan(200);
    expect(t.ids[0]).toBe(1);
    expect(t.ids.at(-1)).toBe(200);
    // Con +1 por línea, el coste estimado no puede pasar del presupuesto.
    const cost = t.text.split("\n").reduce((s, l) => s + Math.ceil(l.length / 4) + 1, 0);
    expect(cost).toBeLessThanOrEqual(150);
    expect([...t.ids].sort((a, b) => a - b)).toEqual(t.ids);
  });

  test("es determinista", () => {
    const a = renderHistoryTimeline(many(120), { budgetTokens: 200 });
    const b = renderHistoryTimeline(many(120), { budgetTokens: 200 });
    expect(a).toEqual(b);
  });

  test("recorta cada línea y nombra las tools sin mostrar argumentos", () => {
    const row = msg(1, "assistant", "x".repeat(500), {
      tool_calls_json: JSON.stringify([{ id: "c1", function: { name: "web_search", arguments: '{"apiKey":"SECRETO"}' } }]),
    });
    const t = renderHistoryTimeline([row], { budgetTokens: 500, lineChars: 40 });
    expect(t.text).toContain("→ tools: web_search");
    expect(t.text).not.toContain("SECRETO");
    expect(t.text.split("→")[0]!.length).toBeLessThan(80);
  });

  test("nunca incluye el contenido de mensajes tool", () => {
    const t = renderHistoryTimeline(
      [msg(1, "user", "hola mundo"), msg(2, "tool", "password=hunter2"), msg(3, "assistant", "listo")],
      { budgetTokens: 500 },
    );
    expect(t.ids).toEqual([1, 3]);
    expect(t.text).not.toContain("hunter2");
  });

  test("presupuesto 0 o sin mensajes: vacío", () => {
    expect(renderHistoryTimeline(many(3), { budgetTokens: 0 }).text).toBe("");
    expect(renderHistoryTimeline([], { budgetTokens: 100 }).ids).toEqual([]);
  });
});

describe("packRecall", () => {
  const hit = (id: number, score: number, content: string) => ({ message: msg(id, "user", content), score });

  test("salta el que no cabe y mete los cortos que siguen", () => {
    const out = packRecall(
      [hit(1, 0.9, "g".repeat(4000)), hit(2, 0.5, "dato corto importante")],
      { budgetTokens: 60, maxCharsPerMessage: 4000 },
    );
    expect(out.map((m) => m.id)).toEqual([2]);
  });

  test("excluye ids ya presentes y devuelve en orden cronológico", () => {
    const out = packRecall(
      [hit(7, 0.9, "siete"), hit(3, 0.8, "tres"), hit(5, 0.7, "cinco")],
      { budgetTokens: 500, maxCharsPerMessage: 100, excludeIds: [7] },
    );
    expect(out.map((m) => m.id)).toEqual([3, 5]);
  });

  test("recorta cada mensaje y no admite tool", () => {
    const out = packRecall(
      [hit(1, 0.9, "a".repeat(300)), { message: msg(2, "tool", "secreto"), score: 1 }],
      { budgetTokens: 500, maxCharsPerMessage: 50 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.content.length).toBeLessThanOrEqual(50);
    expect(renderRecall(out)).toContain("- #1 [user]");
  });
});
