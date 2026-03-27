# @johpaz/hive-code-bridge

Code Bridge for the Hive ecosystem. Exposes a **local WebSocket mesh** (via `Bun.serve`) that spawns and supervises CLI AI tools (e.g. `opencode`, `gemini`, `qwen`, `claude`) as child processes, streaming their output and telemetry to any connected dashboard client.

## Architecture

```
Dashboard (React + Vite 7.3 + TypeScript) ──WS──► @johpaz/hive-code-bridge ──Bun.spawn──► CLI tool
                                                                                          │
                                                                                          ├──► claude
                                                                                          ├──► qwen
                                                                                          ├──► gemini
                                                                                          └──► opencode
                                                    ◄──WS──── telemetry events (stdout chunks, progress, tokens)
```

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | Bun.serve entry point — HTTP health + WebSocket handler |
| `src/schemas.ts` | Zod schemas: `AgentRole`, `SubagentConfig`, `TelemetryEvent`, `DashboardCommand` |
| `src/process-manager.ts` | Spawns/kills processes, streams stdout/stderr, parses `HIVE_PROGRESS` and `HIVE_TOKENS` hints |
| `src/cli-configs.ts` | Centralized configuration for CLI tools (flags, timeouts, env vars) |

## Running

```bash
# From the monorepo root:
bun run packages/code-bridge/src/index.ts

# Or from this package:
bun run src/index.ts
```

Server starts on `ws://localhost:18791` by default (`CODE_BRIDGE_PORT` env override).

## Supported CLI Tools

| CLI | Command | Approval Flag | Headless Flag | Timeout | stdin Close |
|-----|---------|---------------|---------------|---------|-------------|
| **Claude Code** | `claude` | `--no-approve` | N/A | 300s | No |
| **Qwen** | `qwen` | N/A | `--non-interactive` | 180s | **Yes** |
| **Gemini** | `gemini` | `-y` | `--no-interactive` | 240s | No |
| **OpenCode** | `opencode` | `--auto-accept` | `--headless` | 200s | No |

### CLI Configuration Details

#### Claude Code (Anthropic)
```typescript
{
  cmd: "claude",
  defaultArgs: ["--no-approve", "--output-format", "stream"],
  envVars: ["ANTHROPIC_API_KEY"],
  timeoutSeconds: 300,
  requiresStdinClose: false,
}
```
**Best for:** Complex architecture, refactoring, security review, documentation

#### Qwen CLI (Alibaba)
```typescript
{
  cmd: "qwen",
  defaultArgs: ["--non-interactive"],
  envVars: [],
  timeoutSeconds: 180,
  requiresStdinClose: true,  // ← Must close stdin after prompt
}
```
**Best for:** Quick code generation, bug fixes, utility functions

#### Gemini CLI (Google)
```typescript
{
  cmd: "gemini",
  defaultArgs: ["-y", "--quiet"],
  envVars: ["GOOGLE_API_KEY"],
  timeoutSeconds: 240,
  requiresStdinClose: false,
}
```
**Best for:** Code + documentation pairs, multi-language projects, test generation

#### OpenCode
```typescript
{
  cmd: "opencode",
  defaultArgs: ["--headless", "--auto-accept"],
  envVars: [],
  timeoutSeconds: 200,
  requiresStdinClose: false,
}
```
**Best for:** Open source scaffolding, rapid prototyping

## WebSocket Protocol

### Dashboard → Code Bridge

```jsonc
// Launch a CLI subagent
{ 
  "cmd": "launch", 
  "taskId": "uuid", 
  "prompt": "Refactor auth module", 
  "config": { 
    "role": "development", 
    "cli": "claude",
    "args": ["--model", "claude-sonnet-4-20250514"],
    "cwd": "/path/to/project",
    "timeoutSeconds": 300
  } 
}

// Cancel a running agent
{ "cmd": "cancel", "taskId": "uuid" }

// Request current status snapshot
{ "cmd": "status" }

// Heartbeat (keep connection alive)
{ "cmd": "ping" }
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
| `ping` | Server heartbeat (every 30s) |
| `pong` | Heartbeat response |

## HIVE Protocol Hints

CLI tools can emit structured hints in their stdout to feed the dashboard:

```
HIVE_PROGRESS:42
HIVE_TOKENS:input=1200,output=350,model=gemini-2.0-flash
```

These hints are parsed by `process-manager.ts` and broadcast to all connected clients.

## Usage Examples

### Example 1: Launch Claude Code for Refactoring

```typescript
const ws = new WebSocket("ws://localhost:18791/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    cmd: "launch",
    taskId: "refactor-auth-001",
    config: {
      role: "development",
      cli: "claude",
      cwd: "/home/user/my-project",
      timeoutSeconds: 300,
    },
    prompt: `Refactor the authentication module in src/auth.ts to use JWT with refresh tokens. 
             Current implementation uses hardcoded credentials.`
  }));
};
```

### Example 2: Launch Qwen for Quick Bug Fix

```typescript
ws.send(JSON.stringify({
  cmd: "launch",
  taskId: "fix-bug-002",
  config: {
    role: "development",
    cli: "qwen",
    cwd: "/home/user/my-project",
    timeoutSeconds: 120,
  },
  prompt: `Fix the null pointer exception in src/utils.ts line 45. 
           Stack trace: TypeError: Cannot read property 'id' of undefined`
}));
```

### Example 3: Launch Gemini for Code + Docs

```typescript
ws.send(JSON.stringify({
  cmd: "launch",
  taskId: "create-api-003",
  config: {
    role: "development",
    cli: "gemini",
    cwd: "/home/user/my-project",
    timeoutSeconds: 240,
  },
  prompt: `Create a REST API endpoint for user registration with Express.js.
           Include JSDoc comments and input validation.`
}));
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CODE_BRIDGE_PORT` | `18791` | Port for WebSocket server |
| `ANTHROPIC_API_KEY` | — | Required for Claude Code |
| `GOOGLE_API_KEY` | — | Required for Gemini CLI |

## HTTP Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/status` | GET | Status snapshot of all agents |
| `/status/:taskId` | GET | Status for specific task |
| `/cancel/:taskId` | POST | Cancel running task |
| `/ws` | WebSocket | Main WebSocket endpoint |

## Tests

```bash
bun test src/schemas.test.ts
bun test src/process-manager.test.ts
bun test src/cli-configs.test.ts
# or all at once:
bun test
```

Tests cover: schema validation, launch/cancel lifecycle, stdout streaming, progress/token hint parsing, CLI configuration.

## Integration with Hive Dashboard

The React dashboard (Vite 7.3 + TypeScript) connects via `bridgeStore.ts`:

```typescript
// packages/hive-ui/src/stores/bridgeStore.ts
const CODE_BRIDGE_URL = `ws://${hostname}:18791/ws`;

// Connect and listen for events
const ws = new WebSocket(CODE_BRIDGE_URL);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle: agent:started, agent:output, agent:progress, etc.
};
```

## Troubleshooting

### "Missing environment variables" error

Ensure required API keys are set:
```bash
export ANTHROPIC_API_KEY=your-key-here
export GOOGLE_API_KEY=your-key-here
```

### CLI tool not found

Verify CLI is installed and in PATH:
```bash
which claude
which qwen
which gemini
which opencode
```

### Connection refused on ws://localhost:18791

Check if Code Bridge is running:
```bash
curl http://localhost:18791/health
# Should return: {"ok":true,"port":18791}
```

### Process hangs after prompt (Qwen)

Qwen requires stdin to be closed. This is handled automatically by `process-manager.ts` when `requiresStdinClose: true`.

### Claude asks for approval despite --no-approve

Ensure you're using the latest Claude Code version. Older versions may not support `--no-approve`.
