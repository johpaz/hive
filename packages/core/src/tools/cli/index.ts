/**
 * cli_exec - Execute shell commands
 *
 * @category cli
 * @seedId cli_exec
 * @spanish ejecutar comando, terminal, bash, script, consola
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace, expandPath } from "../filesystem/workspace-guard.ts";
import * as fs from "node:fs";

const log = logger.child("cli-exec");

/**
 * Patterns that are unconditionally blocked regardless of workspace config.
 * Checked against the full command string (lowercased).
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\/[^\s]*/, reason: "recursive delete from root" },
  { pattern: /rm\s+-rf\s+~/, reason: "recursive delete from home" },
  { pattern: />\s*\/dev\//, reason: "write to device file" },
  { pattern: /mkfs/, reason: "filesystem format" },
  { pattern: /dd\s+if=/, reason: "raw disk write" },
  { pattern: /:\(\)\s*\{/, reason: "fork bomb pattern" },
  { pattern: /del\s+\/f\s+\/s/, reason: "recursive force delete (Windows)" },
  { pattern: /format\s+[a-z]:/i, reason: "disk format (Windows)" },
];

export const cliExecTool: Tool = {
  name: "cli_exec",
  description: "Execute shell/bash commands in the agent workspace. NOTE: do NOT use for scheduling tasks, use cron.create instead. Spanish: ejecutar comando, terminal, bash, script, consola",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute (supports pipes, redirections, variables)",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (default: 30, max: 300)",
      },
      cwd: {
        type: "string",
        description: "Working directory (default: agent workspace)",
      },
    },
    required: ["command"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const command = params.command as string;
    const timeoutSecs = Math.min((params.timeout as number) ?? 30, 300);
    const timeoutMs = timeoutSecs * 1000;

    // ── Workspace enforcement ──────────────────────────────────────────────────
    const workspace = getWorkspace(config);
    const defaultCwd = workspace ? expandPath(workspace) : process.cwd();

    let cwd: string;
    try {
      const rawCwd = (params.cwd as string) ?? defaultCwd;
      cwd = resolveInWorkspace(rawCwd, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Ensure cwd exists
    if (!fs.existsSync(cwd)) {
      return { ok: false, error: `Working directory not found: ${cwd}` };
    }

    // ── Dangerous pattern check ────────────────────────────────────────────────
    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          ok: false,
          error: `Command not allowed: ${reason}`,
        };
      }
    }

    log.info(`Executing: ${command} (cwd=${cwd})`);

    const t0 = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Use sh -c so pipes, redirections, variables, and quoted args all work
      const proc = Bun.spawn(["/bin/sh", "-c", command], {
        cwd,
        signal: controller.signal,
        stdout: "pipe",
        stderr: "pipe",
      });

      let stdout = "";
      let stderr = "";
      let exitCode: number;

      try {
        [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        exitCode = await proc.exited;
      } catch {
        // AbortController fired — process was killed due to timeout
        exitCode = -1;
        stdout = stdout || "";
        stderr = stderr || `Process killed after ${timeoutSecs}s timeout`;
      } finally {
        clearTimeout(timeoutId);
      }

      const elapsedMs = Math.round(performance.now() - t0);

      return {
        ok: exitCode === 0,
        command,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executionTimeMs: elapsedMs,
        cwd,
      };
    } catch (error) {
      log.error(`Command failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Command execution failed: ${(error as Error).message}`,
      };
    }
  },
};

export function createTools(): Tool[] {
  return [cliExecTool];
}
