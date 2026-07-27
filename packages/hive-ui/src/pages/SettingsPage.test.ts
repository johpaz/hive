import { describe, expect, it } from "vitest";
import { splitPanelTitle } from "./settingsTitle";

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
