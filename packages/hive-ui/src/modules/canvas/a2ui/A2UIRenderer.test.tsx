// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { A2UISurface, ComponentDef } from "@/types/a2ui";
import { A2UIRenderer } from "./A2UIRenderer";

function surface(components: ComponentDef[], rootId = "root"): A2UISurface {
  return { surfaceId: "s", catalogId: "basic", rootId, components, dataModel: {}, componentOrder: components };
}

describe("A2UIRenderer", () => {
  it("renders a card that names itself as its child instead of recursing forever", () => {
    // Real surface from an agent run: this froze the tab until the browser killed it.
    render(
      <A2UIRenderer
        surface={surface([
          { id: "root", component: "Column", children: ["metric_card3", "label"] },
          { id: "metric_card3", component: "Card", child: "metric_card3" },
          { id: "label", component: "Text", text: "Sigue visible" },
        ] as ComponentDef[])}
      />,
    );
    expect(screen.getByText(/metric_card3.*se contiene a sí mismo/)).toBeTruthy();
    expect(screen.getByText("Sigue visible")).toBeTruthy();
  });

  it("stops a cycle through an ancestor", () => {
    render(
      <A2UIRenderer
        surface={surface([
          { id: "root", component: "Column", children: ["a"] },
          { id: "a", component: "Card", child: "b" },
          { id: "b", component: "Column", children: ["a"] },
        ] as ComponentDef[])}
      />,
    );
    expect(screen.getByText(/"a".*se contiene a sí mismo/)).toBeTruthy();
  });

  it("still renders the same component many times as siblings", () => {
    render(
      <A2UIRenderer
        surface={surface([
          { id: "root", component: "Row", children: ["x", "y"] },
          { id: "x", component: "Card", child: "t" },
          { id: "y", component: "Card", child: "t" },
          { id: "t", component: "Text", text: "repetido" },
        ] as ComponentDef[])}
      />,
    );
    expect(screen.getAllByText("repetido")).toHaveLength(2);
  });
});
