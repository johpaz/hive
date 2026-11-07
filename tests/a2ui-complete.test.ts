import { describe, expect, test } from "bun:test"
import { createA2UISurfaceTool, createA2UIUpdateComponentsTool, findIncompleteComponents } from "../packages/core/src/tools/a2ui"
import { canvasManager } from "../packages/core/src/canvas/canvas-manager"

// Lo que el especialista envió de verdad (frames capturados): 8 componentes con solo id, component y weight.
const REAL_SKELETON = [
  { id: "root", component: "Column", weight: 1 },
  { id: "header", component: "Text", weight: 1 },
  { id: "name_label", component: "Text", weight: 1 },
  { id: "name_field", component: "TextField", weight: 1 },
  { id: "checkbox_label", component: "Text", weight: 1 },
  { id: "acceptance_cb", component: "CheckBox", weight: 1 },
  { id: "submit_label", component: "Text", weight: 1 },
  { id: "submit_btn", component: "Button", weight: 1 },
]

const COMPLETE_FORM = [
  { id: "root", component: "Column", children: ["header", "name_field", "acceptance_cb", "submit_btn"] },
  { id: "header", component: "Text", variant: "h2", text: "Formulario" },
  { id: "name_field", component: "TextField", label: "Nombre", value: { path: "/form/name" } },
  { id: "acceptance_cb", component: "CheckBox", label: "Acepto", value: { path: "/form/ok" } },
  { id: "submit_label", component: "Text", text: "Enviar" },
  { id: "submit_btn", component: "Button", child: "submit_label", action: { event: { name: "submit" } } },
]

describe("A2UI components must arrive complete", () => {
  test("the skeleton the specialist really sent is flagged component by component", () => {
    const problems = findIncompleteComponents(REAL_SKELETON)
    expect(problems).toHaveLength(8)
    expect(problems).toContain("root (Column) necesita children")
    expect(problems).toContain("header (Text) necesita text")
    expect(problems).toContain("name_field (TextField) necesita label o value")
    expect(problems).toContain("acceptance_cb (CheckBox) necesita label")
    expect(problems).toContain("submit_btn (Button) necesita child o text")
  })

  test("a complete form passes", () => {
    expect(findIncompleteComponents(COMPLETE_FORM)).toEqual([])
  })

  test("an empty text string and an empty children list are still present", () => {
    expect(findIncompleteComponents([
      { id: "t", component: "Text", text: "" },
      { id: "c", component: "Column", children: [] },
    ])).toEqual([])
  })

  test("templates, bindings and every children form count as present", () => {
    expect(findIncompleteComponents([
      { id: "list", component: "List", children: { path: "/items", componentId: "row" } },
      { id: "row", component: "Text", text: { path: "title" } },
      { id: "r2", component: "Row", children: { explicitList: ["row"] } },
      { id: "r3", component: "Row", children: "row" },
    ])).toEqual([])
  })

  test("the nested form { Card: {...} } is understood", () => {
    expect(findIncompleteComponents([{ id: "c", component: { Card: { child: "x" } } }])).toEqual([])
    expect(findIncompleteComponents([{ id: "c", component: { Card: {} } }])).toEqual(["c (Card) necesita child"])
  })

  test("a modal needs both its trigger and its content", () => {
    expect(findIncompleteComponents([{ id: "m", component: "Modal", trigger: "b" }])).toEqual(["m (Modal) necesita content o contentChild"])
    expect(findIncompleteComponents([{ id: "m", component: "Modal", trigger: "b", content: "d" }])).toEqual([])
  })

  test("dividers, unknown types and non-objects are not checked", () => {
    expect(findIncompleteComponents([{ id: "d", component: "Divider" }, { id: "x", component: "Mystery" }, null, "texto"])).toEqual([])
  })

  test("the tool schema lets a model emit the props of each type", () => {
    const tool = createA2UIUpdateComponentsTool({} as any)
    const items = (tool.parameters as any).properties.components.items
    expect(items.additionalProperties).toBe(true)
    expect(items.required).toEqual(["id", "component"])
    expect(tool.description).toContain("TODO COMPLETO EN UNA SOLA LLAMADA")
  })

  test("an incomplete batch is rejected with instructions and publishes nothing", async () => {
    const tool = createA2UIUpdateComponentsTool({} as any)
    const sessionId = "canvas:test-incomplete"
    await expect(tool.execute({ sessionId, surfaceId: "simple_form", components: REAL_SKELETON }, {} as any)).rejects.toThrow(
      /Componentes incompletos: root \(Column\) necesita children.*No se publicó nada/s,
    )
    expect(canvasManager.getCachedComponents(sessionId, "simple_form")).toEqual([])
  })

  test("creating a surface that already has components does not empty it", async () => {
    const create = createA2UISurfaceTool({} as any)
    const sessionId = "canvas:test-recreate"
    const args = { sessionId, surfaceId: "simple_form", catalogId: "basic" }
    expect(JSON.parse(await create.execute(args, {} as any)).status).toBe("created")
    await canvasManager.sendA2UIMessage(sessionId, "a2ui:updateComponents", { surfaceId: "simple_form", components: COMPLETE_FORM })
    expect(canvasManager.getCachedComponents(sessionId, "simple_form")).toHaveLength(6)

    const again = JSON.parse(await create.execute(args, {} as any))
    expect(again.status).toBe("exists")
    expect(again.componentCount).toBe(6)
    expect(again.hint).toContain("a2ui_update_components")
    expect(canvasManager.getCachedComponents(sessionId, "simple_form")).toHaveLength(6)
  })

  test("an empty surface can be created again, and starting over means delete then create", async () => {
    const create = createA2UISurfaceTool({} as any)
    const sessionId = "canvas:test-restart"
    const args = { sessionId, surfaceId: "s", catalogId: "basic" }
    const first = JSON.parse(await create.execute(args, {} as any))
    expect(first.status).toBe("created")
    expect(first.next).toContain("VACÍA") // tells the model the work is not done
    expect(JSON.parse(await create.execute(args, {} as any)).status).toBe("created") // aún sin componentes
    await canvasManager.sendA2UIMessage(sessionId, "a2ui:updateComponents", { surfaceId: "s", components: COMPLETE_FORM })
    expect(JSON.parse(await create.execute(args, {} as any)).status).toBe("exists")
    await canvasManager.sendA2UIMessage(sessionId, "a2ui:deleteSurface", { surfaceId: "s" })
    expect(JSON.parse(await create.execute(args, {} as any)).status).toBe("created")
    expect(canvasManager.getCachedComponents(sessionId, "s")).toEqual([])
  })

  test("there is no replace flag to offer the model a way around the guard", () => {
    const tool = createA2UISurfaceTool({} as any)
    expect((tool.parameters as any).properties.replace).toBeUndefined()
  })
})
