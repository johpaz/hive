// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitPanelTitle } from "./settingsTitle";
import { VALID_PANELS } from "./SettingsPage";
import { configGroups } from "@/modules/layout/HiveSidebar";

describe("splitPanelTitle", () => {
  it("does not duplicate a multi-word title", () => {
    expect(splitPanelTitle("Perfil de Usuario")).toEqual({
      lead: "Perfil",
      accent: "de Usuario",
    });
  });

  it("preserves ampersand titles as two parts", () => {
    expect(splitPanelTitle("Ética & Alineación")).toEqual({
      lead: "Ética",
      accent: "& Alineación",
    });
  });
});

/**
 * Cada entrada del menú de Ajustes navega a `/settings/<id>`, y SettingsPage
 * descarta cualquier id que no esté en VALID_PANELS cayendo a "herramientas".
 * Cuando se agregó el panel de Actualizaciones faltó esa lista: el ítem
 * aparecía en el menú y al hacerle clic no pasaba nada.
 */
describe("menú de Ajustes", () => {
  it("todo ítem del menú corresponde a un panel válido", () => {
    const ids = configGroups.flatMap((group) => group.items.map((item) => item.id));
    const huerfanos = ids.filter((id) => !VALID_PANELS.includes(id as never));
    expect(huerfanos).toEqual([]);
  });
});
