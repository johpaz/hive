/**
 * code_agent_run drives external coding-agent CLIs. Uses a fake `codex` on PATH
 * so no real model is called: it edits a file and writes its last message.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { codeAgentRunTool } from "../packages/core/src/tools/code-agent/index";

const sh = (cmd: string, cwd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd });
let base: string, repo: string, oldPath: string | undefined;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-test-"));
  repo = path.join(base, "repo");
  const bin = path.join(base, "bin");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  sh("git init -q && git config user.email t@t && git config user.name t && echo a > a.txt && git add -A && git commit -qm init", repo);
  // fake codex: appends to a.txt in -C dir and writes the -o file
  fs.writeFileSync(
    path.join(bin, "codex"),
    `#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in -C) D="$2"; shift;; -o) O="$2"; shift;; esac; shift; done
echo changed >> "$D/a.txt"
echo "hecho" > "$O"
`,
    { mode: 0o755 },
  );
  oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
});

afterAll(() => {
  process.env.PATH = oldPath;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("code_agent_run", () => {
  test("runs in a worktree, returns the diff and leaves the repo untouched", async () => {
    const r = (await codeAgentRunTool.execute({ agent: "codex", prompt: "edit", cwd: repo }, {})) as any;
    expect(r.ok).toBe(true);
    expect(r.isolated).toBe(true);
    expect(r.summary).toBe("hecho");
    expect(r.files_changed).toEqual(["a.txt"]);
    expect(r.diff).toContain("+changed");
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("a\n");
    expect(sh("git worktree list", repo).stdout.toString().trim().split("\n")).toHaveLength(1);
    expect(fs.existsSync(r.patch_path)).toBe(true);
    fs.rmSync(r.patch_path);
  });

  test("rejects unknown agents", async () => {
    const unknown = (await codeAgentRunTool.execute({ agent: "nope", prompt: "x" }, {})) as any;
    expect(unknown.ok).toBe(false);
  });
});

describe("external_code_agent acceptance gate", () => {
  const criterion = [{ id: "diff_checks", description: "diff acotado y checks pasan" }];

  test("passes only when the delivery points to an existing, non-empty patch", async () => {
    const { runAcceptanceChecks } = await import("../packages/core/src/agent/acceptance-checks");
    const patch = path.join(base, "hive-code-agent-123.patch");

    fs.writeFileSync(patch, "diff --git a/a b/a\n");
    const ok = await runAcceptanceChecks({ objective: "x", acceptance: criterion, delivery: `status: completed\npatch_path: ${patch}` });
    expect(ok.status).toBe("passed");

    fs.writeFileSync(patch, "");
    const empty = await runAcceptanceChecks({ objective: "x", acceptance: criterion, delivery: `patch_path: ${patch}` });
    expect(empty.status).toBe("failed");

    const none = await runAcceptanceChecks({ objective: "x", acceptance: criterion, delivery: "status: completed, todo listo" });
    expect(none.status).toBe("failed");
  });
});
