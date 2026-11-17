process.env.HIVE_DB_PATH = ":memory:";

import { describe, expect, test, beforeAll } from "bun:test";
import { col } from "../packages/core/src/storage/hive";
import { setChannelSendFn } from "../packages/core/src/gateway/channel-notify";
import { notifyTaskCompletion } from "../packages/core/src/scheduler/integration";
import { resolveActiveChannels } from "../packages/core/src/tools/cron/index";
import { formatUserDateTime } from "../packages/core/src/utils/date";

const sent: Array<{ channel: string; sessionId: string; message: string }> = [];

beforeAll(async () => {
  setChannelSendFn(async (channel, sessionId, message) => {
    sent.push({ channel, sessionId, message });
  });

  await (await col<any>("users")).put("u1", {
    id: "u1", name: "T", language: "es", timezone: "America/Bogota",
    preferred_cron_channel: "telegram", created_at: 1,
  });
  const ids = await col<any>("userIdentities");
  await ids.put("u1:telegram", { user_id: "u1", channel: "telegram", channel_user_id: "tg-1", linked_at: 1 });
  await ids.put("u1:discord", { user_id: "u1", channel: "discord", channel_user_id: "dc-1", linked_at: 1 });
  await ids.put("u1:slack", { user_id: "u1", channel: "slack", channel_user_id: "sl-1", linked_at: 1 });
  const chans = await col<any>("channels");
  await chans.put("telegram", { id: "telegram", active: true, status: "connected" });
  await chans.put("discord", { id: "discord", active: true, status: "connected" });
  await chans.put("slack", { id: "slack", active: false, status: "disconnected" });
  await (await col<any>("cronJobs")).put("job1", { id: "job1", name: "reporte", channel: "telegram" });
});

describe("cron results go to every active channel", () => {
  test("resolveActiveChannels skips inactive channels", async () => {
    expect((await resolveActiveChannels("u1")).sort()).toEqual(["discord", "telegram"]);
  });

  test("notifyTaskCompletion sends once per active channel with user-timezone time", async () => {
    sent.length = 0;
    await notifyTaskCompletion("job1", "reporte", true, "todo bien");
    expect(sent.map((s) => s.channel).sort()).toEqual(["discord", "telegram"]);
    for (const s of sent) {
      expect(s.message).toContain("todo bien");
      expect(s.message).toContain("(America/Bogota)");
    }
  });

  test("failure also fans out", async () => {
    sent.length = 0;
    await notifyTaskCompletion("job1", "reporte", false, undefined, "boom");
    expect(sent.length).toBe(2);
    expect(sent[0]!.message).toContain("boom");
  });
});

describe("formatUserDateTime", () => {
  test("converts UTC to Bogota (UTC-5)", () => {
    expect(formatUserDateTime("2026-11-17T19:30:05Z", "America/Bogota")).toBe("17/11/2026 14:30:05");
  });
  test("crosses the day boundary", () => {
    expect(formatUserDateTime("2026-11-17T02:00:00Z", "America/Bogota")).toBe("16/11/2026 21:00:00");
  });
  test("invalid zone falls back to UTC, empty gives null", () => {
    expect(formatUserDateTime("2026-11-17T19:30:05Z", "Nope/Zone")).toBe("17/11/2026 19:30:05");
    expect(formatUserDateTime(null, "UTC")).toBeNull();
  });
});
