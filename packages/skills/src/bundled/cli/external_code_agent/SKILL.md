---
name: external_code_agent
description: "Delegate coding tasks to an external coding-agent CLI (Claude Code, Codex, OpenCode, Kimi) in an isolated git worktree and review the resulting diff"
version: 1.0.0
author: Hive Team
icon: "🧑‍💻"
category: cli
permissions:
  - shell_exec
dependencies: []
tools: [code_agent_run, cli_exec]

triggers:
  - "usa codex"
  - "usa claude code"
  - "usa opencode"
  - "usa kimi"
  - "delega a un agente de código"
  - "use codex"
  - "use claude code"
  - "delegate to a coding agent"

preferred_agents: [external_code_agent]

steps:
  - step: 1
    action: write_prompt
    instruction: "Write a self-contained prompt: objective, relevant files, constraints, and how to validate. The external agent has no access to this conversation"
    output: prompt

  - step: 2
    action: code_agent_run
    instruction: "Run the requested CLI (claude, codex, opencode or kimi). If it reports 'not installed' or an auth/credit error, try another agent"
    params:
      agent: "claude | codex | opencode | kimi"
      prompt: "from step 1"
      timeout: 600
    output: run_result

  - step: 3
    action: review_diff
    instruction: "Read files_changed and diff. Reject changes outside the requested scope"
    output: reviewed_diff

  - step: 4
    action: verify
    instruction: "Apply the patch in a scratch copy or inspect it, then run the project's tests with cli_exec. Report patch_path as evidence"
    output: verification

rules:
  - "The CLI works in a throwaway worktree built from HEAD: uncommitted changes are NOT visible to it"
  - "Never merge or apply the patch to the main workspace unless the objective says so"
  - "ok:false with exitCode 1 and an auth/credit message means the CLI is unusable now, not that the task failed"
  - "Always include patch_path in the delivery: acceptance checks require an existing, non-empty patch"

output_format:
  structure: markdown
  sections:
    - "agent"
    - "summary"
    - "files_changed"
    - "patch_path"
    - "validation"
  max_length: "Concise"

examples:
  - user_input: "usa codex para arreglar el bug de sum.ts"
    expected_behavior: "code_agent_run({ agent: 'codex', prompt: ... }) → review diff → run tests → deliver patch_path"
---
