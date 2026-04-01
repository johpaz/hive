# 🐝 Hive Native Tools Reference

Complete reference of all **52 native tools** available in Hive, organized by category.

---

## 📋 Table of Contents

1. [Core Tools (4)](#-core-tools-4)
2. [Agents Tools (14)](#-agents-tools-14)
3. [Canvas Tools (7)](#-canvas-tools-7)
4. [CodeBridge Tools (3)](#-codebridge-tools-3)
5. [Cron Tools (4)](#-cron-tools-4)
6. [Filesystem Tools (7)](#-filesystem-tools-7)
7. [Projects Tools (8)](#-projects-tools-8)
8. [Voice Tools (2)](#-voice-tools-2)
9. [Web Tools (9)](#-web-tools-9)
10. [CLI Tools (1)](#-cli-tools-1)

---

## 🔧 Core Tools (4)

Essential tools for knowledge management, notifications, and progress tracking.

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_knowledge` | Search NATIVE tools, skills, or playbook rules in the knowledge base using full-text search (FTS5). MCP tools are directly available - no need to search them. | `query` (required), `type` (all/tools/skills/playbook), `limit` |
| `notify` | Send a notification or progress update to the user's active channel. Use for long task updates. | `message` (required) |
| `save_note` | Save a note to the scratchpad (survives context compression). | `key` (required), `value` (required), `thread_id` |
| `report_progress` | Report real-time progress of an ongoing task (0-100%). Sends updates to active channel. | `progress` (required), `message` (required), `task_id` |

---

## 🤖 Agents Tools (14)

Tools for managing worker agents, memory, task delegation, and inter-agent communication.

### Memory Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `memory_write` | Store information in persistent long-term memory. | `title` (required), `content` (required) |
| `memory_read` | Retrieve a memory entry by title. | `title` (required) |
| `memory_list` | List all saved memory entries. | *(none)* |
| `memory_search` | Search memories by keyword. | `query` (required) |
| `memory_delete` | Delete a specific memory entry. | `title` (required) |

### Agent Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `agent_create` | Create a new specialized worker agent. | `name` (required), `description`, `system_prompt`, `tools_json` |
| `agent_find` | Find existing running or idle worker agents. | `search`, `status` (idle/active/any) |
| `agent_archive` | Archive or terminate a worker agent. | `agentId` (required) |

### Task Delegation

| Tool | Description | Parameters |
|------|-------------|------------|
| `task_delegate` | Delegate a task to a worker agent and execute immediately (blocking). | `worker_id` (required), `task_description` (required), `task_id`, `project_id` |
| `task_delegate_code` | Delegate a coding task to a CLI subagent (Qwen, Claude, etc.) via Code Bridge. | `cli` (qwen/claude/opencode/gemini), `task_instructions` (required) |
| `task_status` | Get execution status of one or more delegated tasks. | `task_ids` (required, array) |

### Inter-Agent Communication

| Tool | Description | Parameters |
|------|-------------|------------|
| `bus_publish` | Publish a message to the Agent Bus for worker-to-worker communication. | `event_type` (required), `content` (required), `to_worker_id` |
| `bus_read` | Read unread messages from the Agent Bus. | `worker_id`, `limit` |
| `project_updates` | Get recent status updates from workers in the same project. | `project_id` (required), `limit` |

---

## 🎨 Canvas Tools (7)

Tools for rendering visual components, forms, and interactive elements on the canvas.

| Tool | Description | Parameters |
|------|-------------|------------|
| `canvas_render` | Render a component or visualization on the canvas. | `component` (required), `data` (required) |
| `canvas_ask` | Show interactive form and wait for user input. | `questions` (required, array) |
| `canvas_confirm` | Show a confirmation dialog before executing an action. | `message` (required), `action` (required) |
| `canvas_show_card` | Display structured information in card format. Supports Markdown content or key-value items. | `title` (required), `content`, `items` (array of label/value) |
| `canvas_show_progress` | Show progress bar or status indicator. | `bars` (required, array of label/value) |
| `canvas_show_list` | Display key-value list information as a table. | `title` (required), `items` (required, object) |
| `canvas_clear` | Clear current canvas content. | *(none)* |

---

## 💻 CodeBridge Tools (3)

Tools for launching and managing external CLI coding subagents.

| Tool | Description | Parameters |
|------|-------------|------------|
| `codebridge_launch` | Launch an external coding CLI subagent (Claude Code, Qwen CLI, Gemini CLI, OpenCode) via WebSocket. | `cli` (required, qwen/claude/opencode/gemini), `prompt` (required), `role`, `timeoutSeconds` |
| `codebridge_status` | Check the status and output of a running CodeBridge subagent. | `taskId` (required) |
| `codebridge_cancel` | Cancel and terminate a running CodeBridge subagent process. | `taskId` (required) |

---

## ⏰ Cron Tools (4)

Tools for scheduling recurring or one-time jobs.

| Tool | Description | Parameters |
|------|-------------|------------|
| `cron_add` | Schedule a recurring or one-time job using a cron expression. | `name` (required), `cronExpression` (required), `taskType`, `taskConfig`, `maxRuns` |
| `cron_list` | List all scheduled cron jobs and next execution times. | `enabled` (boolean filter) |
| `cron_edit` | Edit an existing cron job expression or config. | `jobId` (required), `cronExpression`, `taskConfig` |
| `cron_remove` | Remove a scheduled cron job. | `jobId` (required) |

---

## 📁 Filesystem Tools (7)

Tools for reading, writing, and managing files in the agent workspace.

| Tool | Description | Parameters |
|------|-------------|------------|
| `fs_read` | Read file content from agent workspace. Supports pagination with offset/limit. | `path` (required), `offset`, `limit` |
| `fs_write` | Create or overwrite file in agent workspace. Creates directories if needed. | `path` (required), `content` (required) |
| `fs_edit` | Edit specific lines in a file. | `path` (required), `edits` (required, array), `dry_run` |
| `fs_delete` | Delete a file from the workspace. | `path` (required) |
| `fs_list` | List files and directories in a workspace folder. | `path`, `recursive` |
| `fs_glob` | Find files matching a glob pattern. | `pattern` (required) |
| `fs_exists` | Check if a file or directory exists. | `path` (required) |

---

## 📊 Projects Tools (8)

Tools for creating and managing projects and tasks with progress tracking.

| Tool | Description | Parameters |
|------|-------------|------------|
| `project_create` | Create a new project with tasks in the database. | `name` (required), `type` (required), `description`, `tasks` (array) |
| `project_list` | List all projects with their status and progress. | `status`, `type` |
| `project_update` | Update project metadata or progress. | `project_id` (required), `name`, `description`, `progress` |
| `project_done` | Mark a project as completed with final result. | `project_id` (required), `result` (required) |
| `project_fail` | Mark a project as failed with error details. | `project_id` (required), `error` (required) |
| `task_create` | Add a task or subtask to an existing project. | `project_id` (required), `name` (required), `description`, `agent_id` |
| `task_update` | Update task status, progress, or metadata. | `task_id` (required), `status`, `progress`, `result` |
| `task_evaluate` | Evaluate task completion and provide feedback. | `task_id` (required), `criteria` |

---

## 🎤 Voice Tools (2)

Tools for audio transcription and text-to-speech synthesis.

| Tool | Description | Parameters |
|------|-------------|------------|
| `voice_transcribe` | Transcribe audio input to text. | `audio` (required), `language` |
| `voice_speak` | Convert text to synthesized speech output. | `text` (required), `voice_id`, `language` |

---

## 🌐 Web Tools (9)

Tools for web search, content fetching, and browser automation (Chromium via Puppeteer).

> Ver documentación detallada: [BROWSER_TOOLS.md](./BROWSER_TOOLS.md)

| Tool | Description | Parameters |
|------|-------------|------------|
| `web_search` | Search the web using DuckDuckGo. Lightweight, no JS. | `query` (required), `numResults` |
| `web_fetch` | Fetch plain text from a URL (no JS, ~200ms). | `url` (required) |
| `browser_navigate` | Navigate to a URL in Chromium (full JS rendering). Returns cleaned page text. | `url` (required), `waitFor`, `timeout` |
| `browser_extract` | Extract text/attributes from elements using CSS selectors or XPath. | `selector` (required), `url`, `attribute`, `all`, `timeout` |
| `browser_screenshot` | Take a PNG screenshot. Supports full-page and element capture. | `url`, `fullPage`, `selector` |
| `browser_click` | Click a page element by CSS selector. | `selector` (required), `url`, `timeout` |
| `browser_type` | Type text into a form field. | `selector` (required), `text` (required), `url`, `clear`, `timeout` |
| `browser_script` | Execute arbitrary JavaScript in the page context. | `script` (required), `url`, `timeout` |
| `browser_wait` | Wait for a selector or JS condition to be true. | `selector`, `condition`, `url`, `timeout`, `state` |

---

## 💻 CLI Tools (1)

Tools for executing shell commands in the agent workspace.

| Tool | Description | Parameters |
|------|-------------|------------|
| `cli_exec` | Execute shell/bash commands in the agent workspace. **NOTE:** Do NOT use for cron scheduling - use `cron_add` instead. Includes safety checks for dangerous patterns. | `command` (required), `timeout`, `cwd` |

**Blocked patterns for safety:**
- `rm -rf /` - Recursive delete from root
- `rm -rf ~` - Recursive delete from home
- `> /dev/*` - Write to device file
- `mkfs` - Filesystem format
- `dd if=` - Raw disk write
- Fork bomb patterns
- Windows: `del /f /s`, `format X:`

---

## 📝 Usage Examples

### Search for a tool
```json
{
  "tool": "search_knowledge",
  "args": {
    "query": "send email",
    "type": "tools",
    "limit": 5
  }
}
```

### Create a project with tasks
```json
{
  "tool": "project_create",
  "args": {
    "name": "Build Feature X",
    "type": "code",
    "description": "Implement new feature",
    "tasks": [
      { "name": "Design API", "description": "Create REST endpoints" },
      { "name": "Implement logic", "description": "Write business logic" }
    ]
  }
}
```

### Display a card with content
```json
{
  "tool": "canvas_show_card",
  "args": {
    "title": "Project Status",
    "content": "### ✅ Completed\n- Task 1\n- Task 2\n\n### 🔄 In Progress\n- Task 3"
  }
}
```

### Delegate task to worker
```json
{
  "tool": "task_delegate",
  "args": {
    "worker_id": "worker123abc",
    "task_description": "Review and refactor the authentication module"
  }
}
```

### Schedule a reminder
```json
{
  "tool": "cron_add",
  "args": {
    "name": "Daily Standup",
    "cronExpression": "0 9 * * *",
    "taskType": "message",
    "taskConfig": { "message": "Time for standup!" }
  }
}
```

---

## 🔐 Security Notes

- **Filesystem tools** are restricted to the agent workspace directory
- **CLI tool** blocks dangerous patterns (rm -rf /, mkfs, dd, etc.)
- **Web tools** use sandboxed fetch with timeouts
- **CodeBridge** requires external service running on localhost:18791

---

*Generated for Hive v1.0 | Total: 52 native tools across 10 categories*
