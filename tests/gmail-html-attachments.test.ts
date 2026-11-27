process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryGoogleTokenStore, configureGoogle, resetGoogle } from "../packages/core/src/google";
import { gmailSendTool } from "../packages/core/src/tools/google/gmail";

let sent: string[] = [];
beforeEach(async () => {
  sent = [];
  const store = new MemoryGoogleTokenStore();
  await store.put("u1", {
    accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3_600_000, email: "a@b.c",
    scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send"],
  });
  configureGoogle({
    clientId: "c", clientSecret: "s", redirectUri: "https://x/cb", tokenStore: store,
    fetch: (async (_u: string, init: RequestInit) => {
      sent.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString("utf-8"));
      return new Response(JSON.stringify({ id: "m1", threadId: "t1" }), { status: 200 });
    }) as unknown as typeof fetch,
  });
});
afterEach(() => resetGoogle());

test("gmail_send manda HTML (con alternativa de texto) y adjunta por path", async () => {
  const ws = mkdtempSync(join(tmpdir(), "gm-"));
  writeFileSync(join(ws, "informe.pdf"), "%PDF-1.4 hola");
  const r: any = await gmailSendTool.execute(
    { to: "x@y.z", subject: "Informe", body: "Hola\n\nAdjunto el informe", confirmed: true, attachments: [{ path: "informe.pdf" }] },
    { configurable: { user_id: "u1", workspace: ws } },
  );
  expect(r.ok).toBe(true);
  const raw = sent[0]!;
  expect(raw).toContain("multipart/mixed");
  expect(raw).toContain("multipart/alternative");
  expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
  expect(raw).toContain('filename="informe.pdf"');
  expect(raw).toContain("Content-Type: application/pdf");
});
