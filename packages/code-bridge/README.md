# @johpaz/hive-code-bridge

Code Bridge for the Hive ecosystem. Exposes a **local WebSocket mesh** (via `Bun.serve`) that spawns and supervises CLI AI tools (e.g. `opencode`, `gemini`, `qwen`) as child processes, streaming their output and telemetry to any connected dashboard client.

## Architecture

```
Dashboard (Angular) ──WS──► @johpaz/hive-code-bridge ──Bun.spawn──► CLI tool (opencode / gemini / qwen…)
                                                    ◄──WS──── telemetry events (stdout chunks, progress, tokens)
```

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | Bun.serve entry point — HTTP health + WebSocket handler |
| `src/schemas.ts` | Zod schemas: `AgentRole`, `SubagentConfig`, `TelemetryEvent`, `DashboardCommand` |
| `src/process-manager.ts` | Spawns/kills processes, streams stdout/stderr, parses `HIVE_PROGRESS` and `HIVE_TOKENS` hints |

## Running

```bash
# From the monorepo root:
bun run packages/code-bridge/src/index.ts

# Or from this package:
bun run src/index.ts
```

Server starts on `ws://localhost:18791` by default (`CODE_BRIDGE_PORT` env override).

## WebSocket Protocol

### Dashboard → Code Bridge

```jsonc
// Launch a CLI subagent
{ "cmd": "launch", "taskId": "uuid", "prompt": "Refactor auth module", "config": { "role": "development", "cli": "opencode" } }

// Cancel a running agent
{ "cmd": "cancel", "taskId": "uuid" }

// Request current status snapshot
{ "cmd": "status" }
```

### Code Bridge → Dashboard (broadcast)

| Event type | Description |
|---|---|
| `code-bridge:status` | Full snapshot of all agents (sent on connect and on `status` command) |
| `agent:started` | Process PID and CLI tool |
| `agent:output` | stdout/stderr chunk |
| `agent:progress` | 0–100 percent (from `HIVE_PROGRESS:<n>` in stdout) |
| `agent:token_usage` | Token counters + model (from `HIVE_TOKENS:input=<n>,output=<n>,model=<name>`) |
| `agent:finished` | Exit code |
| `agent:cancelled` | Cancelled by dashboard |
| `agent:error` | Non-zero exit or spawn error |

## HIVE Protocol Hints

CLI tools can emit structured hints in their stdout to feed the dashboard:

```
HIVE_PROGRESS:42
HIVE_TOKENS:input=1200,output=350,model=gemini-2.0-flash
```

## Tests

```bash
bun test src/schemas.test.ts
bun test src/process-manager.test.ts
# or all at once:
bun test
```

Tests cover: schema validation, launch/cancel lifecycle, stdout streaming, progress/token hint parsing.
