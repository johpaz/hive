/**
 * Secrets must survive a server restart.
 *
 * Regression test for provider API keys (and channel tokens / MCP headers)
 * vanishing on every restart in production: they were written to the OS
 * keychain only, which throws on headless Linux/Docker, leaving the value in
 * a per-process in-memory map that dies with the process.
 *
 * The durability half runs in real subprocesses against a real on-disk
 * HIVE_HOME — a restart is the whole point, so it cannot be faked in-process.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const CORE = path.join(import.meta.dir, "..", "packages", "core", "src");
const hiveHome = mkdtempSync(path.join(tmpdir(), "hive-secrets-"));

// Set before anything imports storage/*: the in-process half of this file
// mints a master key, and it must land in the temp dir, never in the real
// ~/.hive of whoever runs the suite.
process.env.HIVE_HOME = hiveHome;
process.env.HIVE_DB_PATH = ":memory:";

afterAll(() => {
  rmSync(hiveHome, { recursive: true, force: true });
});

/** Run `body` in a fresh process with no OS keychain available. */
async function inRestartedProcess(body: string): Promise<string> {
  const script = `
    process.env.HIVE_HOME = ${JSON.stringify(hiveHome)};
    // Headless Linux / Docker: Bun.secrets has no libsecret to talk to.
    (Bun as any).secrets = {
      get: async () => { throw new Error("keychain unavailable") },
      set: async () => { throw new Error("keychain unavailable") },
      delete: async () => { throw new Error("keychain unavailable") },
    };
    const crypto = await import(${JSON.stringify(path.join(CORE, "storage", "crypto.ts"))});
    const out = await (async () => { ${body} })();
    console.log("__RESULT__" + JSON.stringify(out));
    (await import(${JSON.stringify(path.join(CORE, "storage", "hivedb.ts"))})).closeHiveDb();
  `;
  const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__"));
  if (!line) throw new Error(`subprocess produced no result:\n${stdout}\n${await new Response(proc.stderr).text()}`);
  return line.slice("__RESULT__".length);
}

describe("secret durability without an OS keychain", () => {
  test("provider API keys and channel tokens survive a restart", async () => {
    const written = JSON.parse(
      await inRestartedProcess(`
        return {
          provider: await crypto.storeProviderApiKey("openai", "sk-durable-1234567890"),
          channel: await crypto.storeChannelConfig("telegram", { botToken: "123:ABC" }),
        };
      `)
    );
    // Reported as durable at write time — callers can trust the return value.
    expect(written).toEqual({ provider: true, channel: true });

    const read = JSON.parse(
      await inRestartedProcess(`
        return {
          provider: await crypto.loadProviderApiKey("openai"),
          channel: await crypto.loadChannelConfig("telegram"),
        };
      `)
    );
    expect(read.provider).toBe("sk-durable-1234567890");
    expect(read.channel).toEqual({ botToken: "123:ABC" });
  }, 30_000);

  test("the master key is generated once, readable only by its owner", async () => {
    const keyPath = path.join(hiveHome, ".master.key");
    const mode = statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);

    const before = await Bun.file(keyPath).text();
    await inRestartedProcess(`return await crypto.loadProviderApiKey("openai")`);
    // A second boot must reuse the key — regenerating it would orphan every
    // secret already encrypted with the old one.
    expect(await Bun.file(keyPath).text()).toBe(before);
  }, 30_000);

  test("deleting a secret removes it from the durable store too", async () => {
    await inRestartedProcess(`return await crypto.deleteProviderSecrets("openai")`);
    const read = await inRestartedProcess(`return await crypto.loadProviderApiKey("openai")`);
    expect(JSON.parse(read)).toBe("");
  }, 30_000);
});

describe("keychain compatibility", () => {
  test("a secret that only exists in the OS keychain is still readable", async () => {
    const keychain = new Map<string, string>([["provider:legacy:api_key", "sk-from-keychain"]]);
    const original = (Bun as any).secrets;
    (Bun as any).secrets = {
      get: async ({ name }: { name: string }) => keychain.get(name) ?? null,
      set: async ({ name, value }: { name: string; value: string }) => void keychain.set(name, value),
      delete: async ({ name }: { name: string }) => void keychain.delete(name),
    };
    try {
      const { loadProviderApiKey, storeProviderApiKey } = await import("../packages/core/src/storage/crypto");
      expect(await loadProviderApiKey("legacy")).toBe("sk-from-keychain");

      // New writes are mirrored to the keychain as well, so a downgrade or a
      // desktop install keeps working the way it did before.
      await storeProviderApiKey("mirrored", "sk-mirrored");
      expect(keychain.get("provider:mirrored:api_key")).toBe("sk-mirrored");
    } finally {
      (Bun as any).secrets = original;
    }
  });
});
