import { describe, expect, test } from "bun:test"
import { SEED_DATA } from "../packages/core/src/storage/seed"

const REMOVED_PROJECT_TOOL_NAMES = [
  "project_create",
  "project_list",
  "project_update",
  "project_done",
  "project_fail",
  "task_create",
  "task_update",
  "task_evaluate",
  "project_updates",
]

describe("initial seed data", () => {
  test("does not seed removed project/task tools", () => {
    const seededToolNames = new Set(SEED_DATA.tools.map((tool) => tool.name))

    for (const removedTool of REMOVED_PROJECT_TOOL_NAMES) {
      expect(seededToolNames.has(removedTool)).toBe(false)
    }
  })

  test("does not seed removed projects category", () => {
    expect(SEED_DATA.tools.some((tool) => tool.category === "projects")).toBe(false)
  })
})
