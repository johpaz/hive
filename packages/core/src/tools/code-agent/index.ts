/**
 * code_agent_run - Delegate a coding task to an external coding-agent CLI
 * (Claude Code, Codex, OpenCode, Kimi).
 *
 * The CLI runs inside a throwaway git worktree when the workspace is a git
 * repo, so it can be auto-approved safely. Nothing is merged: the result
 * carries the diff and a patch file for the caller to review and apply.
 *
 * @category cli
 * @seedId code_agent_run
 * @spanish agente de código, delegar código, codex, claude code, opencode, kimi
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace, expandPath } from "../filesystem/workspace-guard.ts";
import { ADAPTERS, type CodeAgentId } from "./adapters.ts";

const log = logger.child("code-agent");

const DEFAULT_TIMEOUT_SECS = 600;
const MAX_TIMEOUT_SECS = 3600;
const MAX_DIFF_CHARS = 20000;

/** Env vars that must never reach an external CLI. */
const SECRET_ENV = /(^|_)(TOKEN|SECRET|PASSWORD|KEY)(_|$)/i;
const KEEP_ENV = new Set(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY", "OPENROUTER_API_KEY"]);

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_ENV.test(k) && !KEEP_ENV.has(k)) continue;
    env[k] = v;
  }
  return env;
}

async function run(argv: string[], cwd: string, opts: { signal?: AbortSignal; env?: Record<string, string> } = {}) {
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", signal: opts.signal, env: opts.env });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const r = await run(["git", "rev-parse", "--show-toplevel"], cwd);
    return r.exitCode === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export const codeAgentRunTool: Tool = {
  name: "code_agent_run",
  // Coding agents are slow; the harness ceiling must exceed the per-call timeout.
  timeoutMs: (MAX_TIMEOUT_SECS + 60) * 1000,
  description:
    "Delegate a coding task to an external coding-agent CLI (claude, codex, opencode, kimi). " +
    "Runs in an isolated git worktree when possible and returns the summary, changed files and diff; " +
    "it never merges into the workspace. Spanish: agente de código externo, delegar programación",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", enum: ["claude", "codex", "opencode", "kimi"], description: "Which coding-agent CLI to use" },
      prompt: { type: "string", description: "Complete, self-contained task instructions for the coding agent" },
      cwd: { type: "string", description: "Repository directory (default: agent workspace)" },
      model: { type: "string", description: "Optional model override understood by that CLI" },
      timeout: { type: "number", description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_SECS}, max ${MAX_TIMEOUT_SECS})` },
    },
    required: ["agent", "prompt"],
  },
  execute: async (params, config) => {
    const agentId = params.agent as CodeAgentId;
    const adapter = ADAPTERS[agentId];
    if (!adapter) return { ok: false, error: `Unknown agent '${String(params.agent)}'. Use: ${Object.keys(ADAPTERS).join(", ")}` };
    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "prompt is required" };

    // Bun.which looks at the PATH the process started with; pass the live one so
    // a PATH changed at runtime (a user shell hook, a test double) is honoured.
    if (!Bun.which(adapter.binary, { PATH: process.env.PATH })) {
      return { ok: false, error: `'${adapter.binary}' is not installed or not in PATH`, hint: "Install that CLI or choose another agent." };
    }

    const workspace = getWorkspace(config);
    let cwd: string;
    try {
      const raw = (params.cwd as string) ?? (workspace ? expandPath(workspace) : process.cwd());
      cwd = resolveInWorkspace(raw, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (!fs.existsSync(cwd)) return { ok: false, error: `Working directory not found: ${cwd}` };

    const timeoutSecs = Math.min(Math.max((params.timeout as number) ?? DEFAULT_TIMEOUT_SECS, 10), MAX_TIMEOUT_SECS);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hive-code-agent-"));
    const root = await gitRoot(cwd);
    let runDir = cwd;
    let worktree: string | null = null;

    if (root) {
      const wt = path.join(tmpDir, "worktree");
      const add = await run(["git", "worktree", "add", "--detach", wt, "HEAD"], root);
      if (add.exitCode === 0) {
        worktree = wt;
        runDir = path.join(wt, path.relative(root, cwd));
      } else {
        log.warn(`worktree failed, running in place with reduced permissions: ${add.stderr.trim()}`);
      }
    }

    const invocation = adapter.build({
      prompt,
      cwd: runDir,
      model: params.model as string | undefined,
      isolated: worktree !== null,
      tmpDir,
    });

    log.info(`code_agent_run ${agentId} (cwd=${runDir}, isolated=${worktree !== null})`);
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);
    let result: { stdout: string; stderr: string; exitCode: number } | null = null;
    let timedOut = false;

    try {
      result = await run(invocation.argv, runDir, { signal: controller.signal, env: cleanEnv() });
    } catch {
      timedOut = controller.signal.aborted;
    } finally {
      clearTimeout(timer);
    }

    let diff = "";
    let files: string[] = [];
    let patchPath: string | undefined;
    if (worktree) {
      await run(["git", "add", "-A"], worktree);
      diff = (await run(["git", "diff", "--cached", "HEAD"], worktree)).stdout;
      files = (await run(["git", "diff", "--cached", "--name-only", "HEAD"], worktree)).stdout.split("\n").filter(Boolean);
      if (diff) {
        patchPath = path.join(os.tmpdir(), `hive-code-agent-${Date.now()}.patch`);
        fs.writeFileSync(patchPath, diff);
      }
      await run(["git", "worktree", "remove", "--force", worktree], root!);
    }

    let lastMessage: string | undefined;
    if (invocation.lastMessageFile && fs.existsSync(invocation.lastMessageFile)) {
      lastMessage = fs.readFileSync(invocation.lastMessageFile, "utf8");
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const elapsedMs = Math.round(performance.now() - t0);
    if (!result) {
      return {
        ok: false,
        agent: agentId,
        error: timedOut ? `${agentId} killed after ${timeoutSecs}s timeout` : `${agentId} failed to run`,
        files_changed: files,
        patch_path: patchPath,
        executionTimeMs: elapsedMs,
      };
    }

    const parsed = adapter.summarize(result.stdout, lastMessage);
    return {
      ok: result.exitCode === 0,
      agent: agentId,
      exitCode: result.exitCode,
      isolated: worktree !== null,
      summary: parsed.summary,
      session_id: parsed.sessionId,
      cost_usd: parsed.costUsd,
      files_changed: files,
      diff: diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…(truncated, see patch_path)` : diff,
      patch_path: patchPath,
      stderr: result.exitCode === 0 ? undefined : result.stderr.trim().slice(-2000),
      executionTimeMs: elapsedMs,
      apply_hint: patchPath ? `git apply ${patchPath}` : undefined,
    };
  },
};

export function createTools(): Tool[] {
  return [codeAgentRunTool];
}
