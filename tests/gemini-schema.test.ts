import { describe, expect, test } from "bun:test";
import { normalizeJsonSchema } from "../packages/core/src/agent/llm-providers/schema-normalizer";
import { normalizeToolSchema, toGeminiSchema, getProviderProfile } from "../packages/core/src/agent/llm-providers/interface";

describe("normalizeJsonSchema", () => {
  test("quita extensiones x-*, $schema y $defs a cualquier profundidad", () => {
    const r = normalizeJsonSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: { type: "string", "x-google-identifier": true },
        items: { type: "array", items: { type: "object", properties: { id: { type: "string", "x-foo": 1 } } } },
      },
      required: ["name"],
    });
    expect(JSON.stringify(r)).not.toContain("x-");
    expect(JSON.stringify(r)).not.toContain("$schema");
    expect(r.required).toEqual(["name"]);
  });
  test("expande $ref locales y elimina $defs", () => {
    const r: any = normalizeJsonSchema({
      type: "object",
      properties: { modo: { $ref: "#/$defs/Modo", description: "el modo" }, otro: { $ref: "#/definitions/Modo" } },
      $defs: { Modo: { type: "string", enum: ["a", "b"], "x-google-enum-descriptions": ["A", "B"] } },
      definitions: { Modo: { type: "string" } },
    });
    expect(r.properties.modo).toEqual({ type: "string", enum: ["a", "b"], description: "el modo" });
    expect(r.properties.otro).toEqual({ type: "string" });
    expect(JSON.stringify(r)).not.toMatch(/\$ref|\$defs|definitions|x-google/);
  });
  test("una referencia circular termina y no deja $ref", () => {
    const r = normalizeJsonSchema({
      type: "object",
      properties: { nodo: { $ref: "#/$defs/Nodo" } },
      $defs: { Nodo: { type: "object", properties: { hijo: { $ref: "#/$defs/Nodo" } } } },
    });
    expect(JSON.stringify(r)).not.toContain("$ref");
  });
  test("una referencia irresoluble se degrada sin $ref", () => {
    const r: any = normalizeJsonSchema({ type: "object", properties: { x: { $ref: "#/$defs/NoExiste", description: "d" } } });
    expect(r.properties.x).toEqual({ description: "d" });
  });
  test("conserva propiedades de usuario que empiezan por x- y valores de enum/default", () => {
    const r: any = normalizeJsonSchema({ type: "object", properties: { "x-rate": { type: "string", enum: ["x-a", "$ref"], default: "x-a" } } });
    expect(r.properties["x-rate"]).toEqual({ type: "string", enum: ["x-a", "$ref"], default: "x-a" });
  });
  test("normalizeToolSchema (OpenAI-compat / NVIDIA) y Gemini lo aplican", () => {
    const sch = { type: "object", properties: { a: { $ref: "#/$defs/A" } }, $defs: { A: { type: "string", "x-google-identifier": true } } };
    expect(JSON.stringify(normalizeToolSchema(sch, getProviderProfile("nvidia")))).not.toMatch(/\$ref|x-google/);
    expect(JSON.stringify(toGeminiSchema(sch))).not.toMatch(/\$ref|x-google/);
  });
});
