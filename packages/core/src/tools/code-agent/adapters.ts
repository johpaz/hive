/**
 * Adapters for external coding-agent CLIs. Each one knows how to run its CLI
 * non-interactively and how to pull a human-readable summary out of the output.
 */

export type CodeAgentId = "claude" | "codex" | "opencode" | "kimi";

export interface AdapterInvocation {
  argv: string[];
  /** Files the CLI writes its final message to (codex), read after exit. */
  lastMessageFile?: string;
}

export interface AdapterInput {
  prompt: string;
  cwd: string;
  model?: string;
  /** True when cwd is a throwaway worktree, so full auto-approval is safe. */
  isolated: boolean;
  tmpDir: string;
}

export interface CodeAgentAdapter {
  id: CodeAgentId;
  binary: string;
  build(input: AdapterInput): AdapterInvocation;
  summarize(stdout: string, lastMessage?: string): { summary: string; sessionId?: string; costUsd?: number };
}

function tail(text: string, max = 4000): string {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

const claude: CodeAgentAdapter = {
  id: "claude",
  binary: "claude",
  build({ prompt, model, isolated }) {
    const argv = [
      "claude", "-p", prompt,
      "--output-format", "json",
      "--permission-mode", isolated ? "bypassPermissions" : "acceptEdits",
    ];
    if (model) argv.push("--model", model);
    return { argv };
  },
  summarize(stdout) {
    try {
      const parsed = JSON.parse(stdout.trim());
      return {
        summary: String(parsed.result ?? ""),
        sessionId: parsed.session_id,
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
      };
    } catch {
      return { summary: tail(stdout) };
    }
  },
};

const codex: CodeAgentAdapter = {
  id: "codex",
  binary: "codex",
  build({ prompt, cwd, model, tmpDir }) {
    const lastMessageFile = `${tmpDir}/codex-last-message.txt`;
    const argv = [
      "codex", "exec",
      "-s", "workspace-write",
      "-C", cwd,
      "--skip-git-repo-check",
      "-o", lastMessageFile,
    ];
    if (model) argv.push("-m", model);
    argv.push(prompt);
    return { argv, lastMessageFile };
  },
  summarize(stdout, lastMessage) {
    return { summary: lastMessage?.trim() || tail(stdout) };
  },
};

const opencode: CodeAgentAdapter = {
  id: "opencode",
  binary: "opencode",
  build({ prompt, model }) {
    const argv = ["opencode", "run", "--auto"];
    if (model) argv.push("-m", model);
    argv.push(prompt);
    return { argv };
  },
  summarize(stdout) {
    return { summary: tail(stdout) };
  },
};

const kimi: CodeAgentAdapter = {
  id: "kimi",
  binary: "kimi",
  // --prompt cannot be combined with --auto/--yolo: prompt mode runs unattended on its own.
  build({ prompt, model }) {
    const argv = ["kimi", "-p", prompt];
    if (model) argv.push("-m", model);
    return { argv };
  },
  summarize(stdout) {
    return { summary: tail(stdout) };
  },
};

export const ADAPTERS: Record<CodeAgentId, CodeAgentAdapter> = { claude, codex, opencode, kimi };
