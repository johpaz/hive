import { describe, expect, test } from "bun:test";
import {
  AgentSynthesisError,
  synthesizeFinalResponse,
} from "../packages/core/src/agent/agent-loop";

describe("agent loop terminal synthesis", () => {
  test("retries once and returns the real model response", async () => {
    let calls = 0;
    const result = await synthesizeFinalResponse(async () => {
      calls++;
      if (calls === 1) throw new Error("temporary provider failure");
      return "Estado real de la tarea";
    });

    expect(result).toBe("Estado real de la tarea");
    expect(calls).toBe(2);
  });

  test("fails closed after two empty or failed responses", async () => {
    let calls = 0;
    const operation = synthesizeFinalResponse(async () => {
      calls++;
      if (calls === 1) return "   ";
      throw new Error("provider unavailable");
    });

    await expect(operation).rejects.toBeInstanceOf(AgentSynthesisError);
    await expect(operation).rejects.toThrow("provider unavailable");
    expect(calls).toBe(2);
  });
});
