import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@/stores/canvasStore";
import type { Agent } from "@/types";
import { officeInteractionsFromEdges, officeWorkersFromAgents } from "./useOfficeModel";

describe("officeInteractionsFromEdges", () => {
  it("projects delegation and review WS edges without inventing outcomes", () => {
    const edges: GraphEdge[] = [
      {
        id: "deleg_task-1",
        source: "coordinator",
        target: "software_engineer",
        edgeType: "delegates",
        data: { taskId: "task-1", taskName: "Implementar búsqueda" },
      },
      {
        id: "review_task-1",
        source: "software_engineer",
        target: "acceptance_verifier",
        edgeType: "reviews",
        data: { taskId: "task-1", taskName: "Implementar búsqueda" },
      },
      {
        id: "unrelated",
        source: "a",
        target: "b",
        edgeType: "connects",
      },
    ];

    expect(officeInteractionsFromEdges(edges)).toEqual([
      {
        id: "deleg_task-1",
        kind: "delegates",
        sourceId: "coordinator",
        targetId: "software_engineer",
        taskId: "task-1",
        taskName: "Implementar búsqueda",
      },
      {
        id: "review_task-1",
        kind: "reviews",
        sourceId: "software_engineer",
        targetId: "acceptance_verifier",
        taskId: "task-1",
        taskName: "Implementar búsqueda",
      },
    ]);
  });
});

describe("officeWorkersFromAgents", () => {
  it("uses every worker from the database regardless of source or archive state", () => {
    const base = {
      description: "",
      status: "idle",
      enabled: true,
      providerId: "test",
      modelId: "test",
    } as const;
    const agents: Agent[] = [
      { ...base, id: "coordinator", name: "Bee", role: "coordinator", source: "user" },
      { ...base, id: "catalog", name: "Catálogo", role: "worker", source: "catalog" },
      { ...base, id: "custom", name: "Personalizado", role: "worker", source: "user" },
      { ...base, id: "manual-archive", name: "Archivado", role: "worker", source: "user", status: "archived" },
    ];

    expect(officeWorkersFromAgents(agents).map((agent) => agent.id)).toEqual([
      "catalog",
      "custom",
      "manual-archive",
    ]);
  });
});
