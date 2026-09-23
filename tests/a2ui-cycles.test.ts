import { describe, expect, test } from "bun:test"
import { findComponentCycle } from "../packages/core/src/tools/a2ui"
import { mergeComponentsById } from "../packages/core/src/canvas/canvas-manager"

describe("A2UI component cycles", () => {
  test("detects a card that names itself as its child (real agent output)", () => {
    expect(findComponentCycle([
      { id: "root", component: "Column", children: ["metric_card3"] },
      { id: "metric_card3", component: "Card", child: "metric_card3" },
    ])).toEqual(["metric_card3", "metric_card3"])
  })

  test("detects a cycle through an ancestor, in the nested form too", () => {
    expect(findComponentCycle([
      { id: "a", component: { Card: { child: "b" } } },
      { id: "b", component: "Column", children: { explicitList: ["a"] } },
    ])).toEqual(["a", "b", "a"])
  })

  test("a shared child is not a cycle", () => {
    expect(findComponentCycle([
      { id: "root", component: "Row", children: ["x", "y"] },
      { id: "x", component: "Card", child: "t" },
      { id: "y", component: "Card", child: "t" },
      { id: "t", component: "Text", text: "hi" },
    ])).toBeNull()
  })

  test("an update can close a cycle with components sent earlier", () => {
    const earlier = [{ id: "root", component: "Column", children: ["card"] }, { id: "card", component: "Card", child: "body" }]
    const update = [{ id: "body", component: "Column", children: ["root"] }]
    expect(findComponentCycle(update)).toBeNull()
    expect(findComponentCycle(mergeComponentsById(earlier, update))).toEqual(["root", "card", "body", "root"])
  })

  test("merging keeps earlier components and replaces by id", () => {
    const merged = mergeComponentsById([{ id: "a", v: 1 }, { id: "b", v: 1 }], [{ id: "b", v: 2 }, { id: "c", v: 1 }])
    expect(merged).toEqual([{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 1 }])
  })
})
