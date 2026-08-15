import { describe, expect, test } from "bun:test";
import {
  AgentSynthesisError,
  injectArtifactReadIfNeeded,
  synthesizeFinalResponse,
} from "../packages/core/src/agent/agent-loop";

describe("agent loop terminal synthesis", () => {
  test("retries once and returns the real model response", async () => {
    let calls = 0;
    const result = await synthesizeFinalResponse(async () => {
      calls++;
      if (calls === 1) throw new Error("temporary provider failure");
      return "Estado real de la tarea";
    });

    expect(result).toBe("Estado real de la tarea");
    expect(calls).toBe(2);
  });

  test("fails closed after two empty or failed responses", async () => {
    let calls = 0;
    const operation = synthesizeFinalResponse(async () => {
      calls++;
      if (calls === 1) return "   ";
      throw new Error("provider unavailable");
    });

    await expect(operation).rejects.toBeInstanceOf(AgentSynthesisError);
    await expect(operation).rejects.toThrow("provider unavailable");
    expect(calls).toBe(2);
  });
});

describe("artifact_read loadout injection", () => {
  const reader = { name: "artifact_read", description: "read it", parameters: { type: "object", properties: {} } };
  const textRef = { type: "artifact_ref", artifact_id: "a1", mime_type: "text/plain", size: 245233 };

  test("adds the reader as soon as a result carries a text artifact_ref", () => {
    const ctx = { tools: [{ type: "function", function: { name: "email__buscaEmail" } }], allTools: [reader] };
    expect(injectArtifactReadIfNeeded([textRef], ctx as never)).toBe(true);
    expect(ctx.tools.map((t: any) => t.function.name)).toContain("artifact_read");
  });

  test("does not add it twice", () => {
    const ctx = { tools: [{ type: "function", function: { name: "artifact_read" } }], allTools: [reader] };
    expect(injectArtifactReadIfNeeded([textRef], ctx as never)).toBe(false);
    expect(ctx.tools.length).toBe(1);
  });

  test("ignores image refs — those go to the UI, the model never reads them back", () => {
    const ctx = { tools: [], allTools: [reader] };
    const imageRef = { type: "artifact_ref", artifact_id: "a2", mime_type: "image/png", size: 12 };
    expect(injectArtifactReadIfNeeded([imageRef], ctx as never)).toBe(false);
    expect(ctx.tools.length).toBe(0);
  });

  test("leaves ordinary results alone", () => {
    const ctx = { tools: [], allTools: [reader] };
    expect(injectArtifactReadIfNeeded([{ type: "text", text: "ok" }], ctx as never)).toBe(false);
    expect(injectArtifactReadIfNeeded({ ok: true }, ctx as never)).toBe(false);
    expect(ctx.tools.length).toBe(0);
  });
});
