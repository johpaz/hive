import type { Tool } from "../types";
import { inspectArtifact } from "../../artifacts/store";

export const artifactInspectTool: Tool = {
  name: "artifact_inspect",
  description: "Inspect managed artifact metadata, integrity, MIME type and dimensions without returning or modifying its binary content.",
  parameters: {
    type: "object",
    properties: {
      artifactId: {
        type: "string",
        description: "Managed artifact identifier returned by a Hive tool.",
      },
    },
    required: ["artifactId"],
  },
  execute: async (params, config) => {
    const artifactId = String(params.artifactId ?? "").trim();
    if (!artifactId) return { ok: false, error: "artifactId is required" };
    const userId = config?.configurable?.user_id as string | undefined;
    return inspectArtifact(artifactId, { userId });
  },
};
