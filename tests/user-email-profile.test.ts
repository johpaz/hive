process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../packages/core/src/agent/prompt-builder";
import { handleAuthStatus, handleSetupCredentials } from "../packages/core/src/gateway/routes/auth";
import {
  handleGetUsers,
  handleUpdateUserSettings,
} from "../packages/core/src/gateway/routes/users";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import { saveUserProfile } from "../packages/core/src/storage/onboarding";
import type { UserDoc } from "../packages/core/src/storage/collections";

const cors = (response: Response) => response;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("user profile email", () => {
  test("stores one normalized email without enabling password authentication", async () => {
    const userId = await saveUserProfile({
      userName: "Ada",
      userEmail: "  ADA@Example.COM ",
    });

    const user = await (await col<UserDoc>("users")).get(userId);
    expect(user?.doc.email).toBe("ada@example.com");
    expect(user?.doc.password_hash).toBeNull();

    const response = await handleAuthStatus(new Request("http://localhost/api/auth/status"), cors);
    expect(await response.json()).toEqual({ hasCredentials: false, email: null });
  });

  test("enables a password later using the profile email without asking for it again", async () => {
    const userId = await saveUserProfile({
      userName: "Ada",
      userEmail: "ada@example.com",
    });

    const response = await handleSetupCredentials(
      new Request("http://localhost/api/auth/setup-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct-horse" }),
      }),
      cors,
    );
    expect(response.status).toBe(200);

    const user = await (await col<UserDoc>("users")).get(userId);
    expect(user?.doc.email).toBe("ada@example.com");
    expect(user?.doc.password_hash).toBeString();

    const status = await handleAuthStatus(new Request("http://localhost/api/auth/status"), cors);
    expect(await status.json()).toEqual({ hasCredentials: true, email: "ada@example.com" });
  });

  test("returns and updates the same email through the profile API", async () => {
    const userId = await saveUserProfile({
      userName: "Ada",
      userEmail: "ada@example.com",
    });

    const updateResponse = await handleUpdateUserSettings(
      new Request(`http://localhost/api/user/settings?userId=${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "  NEW@Example.com " }),
      }),
      cors,
    );
    expect(updateResponse.status).toBe(200);

    const getResponse = await handleGetUsers(new Request("http://localhost/api/users"), cors);
    const body = await getResponse.json() as { users: Array<{ email: string | null }> };
    expect(body.users[0]?.email).toBe("new@example.com");
  });

  test("rejects an invalid profile email without replacing the stored value", async () => {
    const userId = await saveUserProfile({
      userName: "Ada",
      userEmail: "ada@example.com",
    });

    const response = await handleUpdateUserSettings(
      new Request(`http://localhost/api/user/settings?userId=${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
      cors,
    );

    expect(response.status).toBe(400);
    expect((await (await col<UserDoc>("users")).get(userId))?.doc.email).toBe("ada@example.com");
  });

  test("exposes the own email only in the coordinator identity context", async () => {
    const userId = await saveUserProfile({
      userName: "Ada",
      userEmail: "ada@example.com",
      agentId: "coordinator-email-test",
      agentName: "Bee",
    });

    const coordinatorPrompt = await buildSystemPrompt({
      agentId: "coordinator-email-test",
      userId,
    });
    const workerPrompt = await buildSystemPrompt({
      agentId: "web_researcher",
      userId,
    });

    expect(coordinatorPrompt).toContain("CorreoPropio");
    expect(coordinatorPrompt).toContain("ada@example.com");
    expect(coordinatorPrompt).toContain("envíame");
    expect(workerPrompt).not.toContain("ada@example.com");
  });
});
