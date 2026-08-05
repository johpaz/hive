/**
 * tool-selector — las tools que sólo viven en la colección `tools`.
 *
 * `syncToolCatalogToIndex` construye el índice BM25 con CORE_TOOL_CATALOG **más**
 * las filas de la colección. `selectTools`, en cambio, resolvía los hits contra
 * `fullToolList`, que por defecto es sólo CORE_TOOL_CATALOG. Una tool registrada
 * en runtime podía salir primera en la búsqueda y aun así no llegar nunca al
 * modelo: el hit se descartaba en silencio, sin log ni error.
 *
 * Acá no se notaba porque todas las tools de hive están en el catálogo estático.
 * Se detectó en el SDK, donde las apps declaran tools con `defineTool`.
 *
 * Usa HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ToolDoc } from "../packages/core/src/storage/collections";
import { selectTools, syncToolCatalogToIndex } from "../packages/core/src/agent/tool-selector";

/** Nombre y vocabulario deliberadamente ajenos al catálogo estático. */
const RUNTIME_TOOL = "consultar_inventario_ferreteria";
const QUERY = "necesito consultar el inventario de la ferretería";

async function registerRuntimeTool(overrides: Partial<ToolDoc> = {}): Promise<void> {
  const tools = await col<ToolDoc>("tools");
  await tools.put(RUNTIME_TOOL, {
    id: RUNTIME_TOOL,
    name: RUNTIME_TOOL,
    description: "Consulta el inventario de la ferretería: stock, existencias y precios de artículos",
    category: "core",
    enabled: true,
    active: true,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  });
}

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("selectTools con tools registradas en runtime", () => {
  test("una tool que sólo está en la colección llega al modelo", async () => {
    await registerRuntimeTool();
    await syncToolCatalogToIndex();

    const selected = await selectTools(QUERY);

    expect(selected.map((t) => t.name)).toContain(RUNTIME_TOOL);
  });

  test("conserva la descripción de la fila — es lo que el modelo lee para decidir", async () => {
    await registerRuntimeTool();
    await syncToolCatalogToIndex();

    const tool = (await selectTools(QUERY)).find((t) => t.name === RUNTIME_TOOL);

    expect(tool?.description).toContain("inventario de la ferretería");
  });

  test("una tool deshabilitada no se ofrece aunque esté indexada", async () => {
    // El índice se construye desde la colección sin mirar `enabled`, así que la
    // única defensa es el filtro al resolver el hit.
    await registerRuntimeTool({ enabled: false });
    await syncToolCatalogToIndex();

    const selected = await selectTools(QUERY);

    expect(selected.map((t) => t.name)).not.toContain(RUNTIME_TOOL);
  });

  test("una tool inactiva tampoco se ofrece", async () => {
    await registerRuntimeTool({ active: false });
    await syncToolCatalogToIndex();

    const selected = await selectTools(QUERY);

    expect(selected.map((t) => t.name)).not.toContain(RUNTIME_TOOL);
  });

  test("un hit sin fila en la colección se descarta sin romper la selección", async () => {
    // El índice puede quedar con basura de una tool borrada; el resto del
    // loadout tiene que seguir funcionando.
    await registerRuntimeTool();
    await syncToolCatalogToIndex();
    await (await col<ToolDoc>("tools")).delete(RUNTIME_TOOL);

    const selected = await selectTools(QUERY);

    expect(selected.map((t) => t.name)).not.toContain(RUNTIME_TOOL);
    expect(Array.isArray(selected)).toBe(true);
  });

  test("no rompe la resolución de las tools del catálogo estático", async () => {
    await registerRuntimeTool();
    await syncToolCatalogToIndex();

    const selected = await selectTools("buscá en la web información sobre tarifas de envío");

    expect(selected.length).toBeGreaterThan(0);
    for (const tool of selected) {
      expect(tool.name).toBeString();
      expect(tool.description).toBeString();
    }
  });
});
