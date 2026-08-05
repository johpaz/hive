/**
 * Alta y edición de modelos desde la UI de providers.
 *
 * El formulario manda el nombre de cable; la fila se guarda con la clave de
 * catálogo (prefijada en los revendedores). Y el precio tiene que aterrizar en
 * la BD, que es de donde sale el costo del dashboard.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ModelDoc } from "../packages/core/src/storage/collections";
import {
  handleCreateModel,
  handleUpdateModel,
  handleGetModels,
} from "../packages/core/src/gateway/routes/models";

const passthrough = (r: Response) => r;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/models", { method: "POST", body: JSON.stringify(body) });
}

function put(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/models/${encodeURIComponent(id)}`, {
    method: "PUT", body: JSON.stringify(body),
  });
}

describe("POST /api/models", () => {
  test("persiste contexto, precio y capacidades", async () => {
    const res = await handleCreateModel(post({
      provider_id: "anthropic",
      id: "modelo-propio",
      name: "Mi modelo",
      context_window: 123456,
      input_per_1m: 2.5,
      output_per_1m: 10,
      capabilities: ["chat", "function_calling"],
    }), passthrough);

    expect(res.status).toBe(201);
    const doc = (await (await col<ModelDoc>("models")).get("modelo-propio"))!.doc;
    expect(doc.context_window).toBe(123456);
    expect(doc.input_per_1m).toBe(2.5);
    expect(doc.output_per_1m).toBe(10);
    expect(JSON.parse(doc.capabilities!)).toEqual(["chat", "function_calling"]);
  });

  test("prefija la clave en un provider revendedor pero deja el nombre de cable", async () => {
    await handleCreateModel(post({
      provider_id: "openrouter", id: "acme/modelo-x", name: "Acme X",
      input_per_1m: 1, output_per_1m: 2,
    }), passthrough);

    const modelsCol = await col<ModelDoc>("models");
    expect(await modelsCol.get("openrouter/acme/modelo-x")).toBeTruthy();

    const res = await handleGetModels(
      new Request("http://localhost/api/models?provider_id=openrouter"), passthrough
    );
    const { models } = await res.json() as { models: Array<{ id: string; wire_id: string }> };
    const created = models.find((m) => m.id === "openrouter/acme/modelo-x")!;
    expect(created.wire_id).toBe("acme/modelo-x");
  });

  test("queda como 'discovered' para que el wipe del re-seed no lo borre", async () => {
    await handleCreateModel(post({ provider_id: "anthropic", id: "hecho-a-mano", name: "A mano" }), passthrough);
    const doc = (await (await col<ModelDoc>("models")).get("hecho-a-mano"))!.doc;
    expect(doc.source).toBe("discovered");
  });

  test("sin precio queda null — 'sin tarifa', no gratis", async () => {
    await handleCreateModel(post({ provider_id: "anthropic", id: "sin-precio", name: "Sin precio" }), passthrough);
    const doc = (await (await col<ModelDoc>("models")).get("sin-precio"))!.doc;
    expect(doc.input_per_1m).toBeNull();
    expect(doc.output_per_1m).toBeNull();
  });

  test("0 se guarda como 0 y no se confunde con null", async () => {
    await handleCreateModel(post({
      provider_id: "anthropic", id: "gratis", name: "Gratis",
      input_per_1m: 0, output_per_1m: 0,
    }), passthrough);
    const doc = (await (await col<ModelDoc>("models")).get("gratis"))!.doc;
    expect(doc.input_per_1m).toBe(0);
    expect(doc.output_per_1m).toBe(0);
  });
});

describe("PUT /api/models/:id", () => {
  const seedModel = () => handleCreateModel(post({
    provider_id: "anthropic", id: "editable", name: "Editable",
    context_window: 1000, input_per_1m: 1, output_per_1m: 2,
  }), passthrough);

  test("actualiza contexto y precio sin renombrar", async () => {
    await seedModel();
    await handleUpdateModel(put("editable", { context_window: 5000, input_per_1m: 7.5 }), passthrough);

    const doc = (await (await col<ModelDoc>("models")).get("editable"))!.doc;
    expect(doc.context_window).toBe(5000);
    expect(doc.input_per_1m).toBe(7.5);
    // Lo que no se mandó no se toca.
    expect(doc.output_per_1m).toBe(2);
    expect(doc.name).toBe("Editable");
  });

  test("permite volver a 'sin tarifa' mandando null", async () => {
    await seedModel();
    await handleUpdateModel(put("editable", { input_per_1m: null, output_per_1m: null }), passthrough);

    const doc = (await (await col<ModelDoc>("models")).get("editable"))!.doc;
    expect(doc.input_per_1m).toBeNull();
    expect(doc.output_per_1m).toBeNull();
  });

  test("el rename conserva los otros campos editados en el mismo submit", async () => {
    await seedModel();
    await handleUpdateModel(put("editable", {
      id: "renombrado", name: "Renombrado", context_window: 9000, output_per_1m: 42,
    }), passthrough);

    const modelsCol = await col<ModelDoc>("models");
    expect(await modelsCol.get("editable")).toBeFalsy();
    const doc = (await modelsCol.get("renombrado"))!.doc;
    expect(doc.name).toBe("Renombrado");
    expect(doc.context_window).toBe(9000);
    expect(doc.output_per_1m).toBe(42);
    expect(doc.input_per_1m).toBe(1);
  });
});
