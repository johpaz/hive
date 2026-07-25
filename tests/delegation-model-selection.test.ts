import { describe, expect, test } from "bun:test";
import { resolveAgentModel } from "../packages/core/src/agent/delegation-runtime";

const legacyOverride = {
  required_capabilities: ["reasoning", "function_calling"],
  preferred_model_ids: ["hardcoded-model-that-must-not-win"],
  fallback: "general" as const,
  prefer_different_family: true,
};

describe("delegation model selection", () => {
  test("uses the agent provider/model stored in the database before catalog metadata", async () => {
    const selected = await resolveAgentModel(
      legacyOverride,
      "gemini",
      "gemini-3.6-flash",
      "other-provider",
      "other-model",
      "gemini-3.6-flash",
    );

    expect(selected).toEqual({
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });
  });

  test("inherits the parent database provider/model when the worker has none", async () => {
    const selected = await resolveAgentModel(
      legacyOverride,
      null,
      null,
      "gemini",
      "gemini-3.6-flash",
      "gemini-3.6-flash",
    );

    expect(selected).toEqual({
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });
  });
});
