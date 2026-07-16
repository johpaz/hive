/**
 * Regression guard for a real bug found via a live Gemini call: a tool
 * parameter schema with `{ type: "array" }` and no `items` sub-schema is
 * valid JSON Schema (items is optional) but rejected by Gemini's stricter
 * function-calling validator. ensureArrayItems() patches this at the wire
 * boundary for every provider that doesn't already normalize schemas
 * (gemini.ts, anthropic.ts, ollama.ts) — the OpenAI-compatible providers get
 * it for free via normalizeToolSchema().
 */

import { describe, test, expect } from "bun:test";
import { ensureArrayItems } from "../packages/core/src/agent/llm-providers/interface";
import { createAllTools } from "../packages/core/src/tools/index.ts";

function findMissingItems(schema: any, path: string, out: string[]): void {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "array" && !schema.items) out.push(path);
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      findMissingItems(v, `${path}.properties.${k}`, out);
    }
  }
  if (schema.items) findMissingItems(schema.items, `${path}.items`, out);
}

describe("ensureArrayItems", () => {
  test("adds an empty items schema to a top-level array missing one", () => {
    const result = ensureArrayItems({ type: "array" });
    expect(result.items).toEqual({});
  });

  test("adds items to a nested array inside object properties", () => {
    const schema = {
      type: "object",
      properties: {
        hojas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              datos: { type: "array" },
            },
          },
        },
      },
    };
    const result = ensureArrayItems(schema);
    expect(result.properties.hojas.items.properties.datos.items).toEqual({});
  });

  test("leaves an array that already has items untouched", () => {
    const schema = { type: "array", items: { type: "string" } };
    const result = ensureArrayItems(schema);
    expect(result.items).toEqual({ type: "string" });
  });

  test("leaves non-array schemas untouched", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const result = ensureArrayItems(schema);
    expect(result).toEqual(schema);
  });

  test("handles null/undefined/primitive input without throwing", () => {
    expect(ensureArrayItems(null)).toBeNull();
    expect(ensureArrayItems(undefined)).toBeUndefined();
    expect(ensureArrayItems("string")).toBe("string");
  });
});

describe("tool catalog: no array schema is missing items", () => {
  test("every native tool's parameter schema has items on every array node", () => {
    const tools = createAllTools({ tools: {} });
    const offenders: string[] = [];
    for (const tool of tools) {
      const out: string[] = [];
      findMissingItems((tool as any).parameters, "$", out);
      if (out.length > 0) offenders.push(`${tool.name}: ${out.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
