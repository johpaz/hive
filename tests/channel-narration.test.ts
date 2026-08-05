process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  resolveNarrationMode,
  shouldDeliverToChannel,
  formatNarrationForChannel,
  enqueueChannelNarration,
  awaitChannelNarration,
  invalidateNarrationModeCache,
  DEFAULT_NARRATION_MODE,
  type NarrationMode,
} from "../packages/core/src/events/channel-narration";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { ChannelDoc, NarrationEventDoc } from "../packages/core/src/storage/collections";

function event(overrides: Partial<NarrationEventDoc>): NarrationEventDoc {
  return {
    id: "e1",
    turn_id: "turn-1",
    thread_id: "thread-1",
    channel: "whatsapp",
    user_id: "user-1",
    session_id: "573001112233",
    agent_id: "agent-a",
    agent_name: "Agente A",
    kind: "tool_call",
    status: "running",
    label: "Agente A: Buscando en la web...",
    detail: null,
    dedupe_key: "k",
    created_at: Date.now(),
    ...overrides,
  };
}

async function seedChannel(type: string, mode: string): Promise<void> {
  const channels = await col<ChannelDoc>("channels");
  await channels.put(type, {
    id: type, user_id: "", type, enabled: true, active: true, status: "connected",
    last_active: null, voice_enabled: false, tts_enabled: false, stt_provider: null,
    tts_provider: null, tts_voice_id: null, step_delivery_mode: mode,
    vision_enabled: false, ocr_provider: null, vision_provider: null, vision_model_id: null,
  });
}

beforeEach(() => {
  closeHiveDb();
  invalidateNarrationModeCache();
});
afterEach(() => {
  closeHiveDb();
  invalidateNarrationModeCache();
});

describe("narration mode resolution", () => {
  test("reads the channel's configured mode", async () => {
    await seedChannel("whatsapp", "all");
    expect(await resolveNarrationMode("whatsapp")).toBe("all");
  });

  test("maps the legacy step_delivery_mode value to the default", async () => {
    await seedChannel("whatsapp", "new_messages");
    expect(await resolveNarrationMode("whatsapp")).toBe(DEFAULT_NARRATION_MODE);
  });

  test("falls back to the default for an unknown channel", async () => {
    expect(await resolveNarrationMode("telegram")).toBe(DEFAULT_NARRATION_MODE);
  });
});

describe("delivery filtering", () => {
  const inMode = (mode: NarrationMode, kinds: NarrationEventDoc["kind"][]) =>
    kinds.filter((kind) => shouldDeliverToChannel(event({ kind }), mode));

  test("off delivers nothing", () => {
    expect(inMode("off", ["tool_call", "verified", "failed", "group_ready"])).toEqual([]);
  });

  test("milestones drops per-tool chatter but keeps the delegation lifecycle", () => {
    expect(shouldDeliverToChannel(event({ kind: "tool_call" }), "milestones")).toBe(false);
    expect(inMode("milestones", ["delegated", "worker_started", "verified", "failed", "group_ready"]))
      .toEqual(["delegated", "worker_started", "verified", "failed", "group_ready"]);
  });

  test("all adds tool calls but still skips successful tool results", () => {
    expect(shouldDeliverToChannel(event({ kind: "tool_call" }), "all")).toBe(true);
    expect(shouldDeliverToChannel(event({ kind: "tool_result", status: "done" }), "all")).toBe(false);
    expect(shouldDeliverToChannel(event({ kind: "tool_result", status: "error" }), "all")).toBe(true);
  });
});

describe("channel formatting", () => {
  test("prefixes the label and omits an absent detail", () => {
    expect(formatNarrationForChannel(event({ kind: "verified", label: "Agente A completó “X”" })))
      .toBe("✅ Agente A completó “X”");
  });

  test("flattens and truncates raw error details", () => {
    const detail = `Error at /home/user/app.ts\n\n${"x".repeat(400)}`;
    const text = formatNarrationForChannel(event({ kind: "failed", status: "error", label: "Falló", detail }));
    const [, second] = text.split("\n");
    expect(text.split("\n")).toHaveLength(2);
    expect(second!.length).toBe(200);
    expect(second!.endsWith("…")).toBe(true);
    expect(second!.includes("\n")).toBe(false);
  });
});

describe("delivery queue", () => {
  test("sends in order and awaits only the matching conversation", async () => {
    const sent: string[] = [];
    const send = (label: string, delayMs: number) => async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      sent.push(label);
    };

    enqueueChannelNarration("whatsapp:a", send("a1", 20));
    enqueueChannelNarration("whatsapp:a", send("a2", 1));
    enqueueChannelNarration("whatsapp:b", send("b1", 1));

    await awaitChannelNarration("whatsapp:a");
    expect(sent.filter((s) => s.startsWith("a"))).toEqual(["a1", "a2"]);
  });

  test("a failing send does not stall the rest of the queue", async () => {
    const sent: string[] = [];
    enqueueChannelNarration("whatsapp:c", async () => { throw new Error("not connected"); });
    enqueueChannelNarration("whatsapp:c", async () => { sent.push("after"); });

    await awaitChannelNarration("whatsapp:c");
    expect(sent).toEqual(["after"]);
  });
});
