/**
 * Hive CLI - Cron Commands
 * 
 * Terminal interface for managing scheduled tasks.
 * Commands: add, list, pause, resume, delete, trigger, history
 */

import * as p from "@clack/prompts";
import { getHiveDir } from "@johpaz/hive-agents-core/config/loader";
import { getDb, initializeDatabase } from "@johpaz/hive-agents-core/storage/sqlite";

const API_BASE = "http://127.0.0.1:18790/api";

/**
 * Get user's timezone from database
 */
function getUserTimezone(): string {
  try {
    initializeDatabase();
    const db = getDb();
    const user = db.query("SELECT timezone FROM users LIMIT 1").get() as { timezone: string } | undefined;
    return user?.timezone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Make API request to gateway
 */
async function apiRequest(path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

export async function cron(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      await listCron(args);
      break;
    case "add":
      await addCron(args);
      break;
    case "pause":
      await cronAction("pause", args[0]);
      break;
    case "resume":
      await cronAction("resume", args[0]);
      break;
    case "delete":
      await cronAction("delete", args[0]);
      break;
    case "trigger":
      await cronAction("trigger", args[0]);
      break;
    case "history":
      await cronHistory(args[0]);
      break;
    case "status":
      await cronStatus();
      break;
    default:
      console.log(`
Usage: hive cron <command> [options]

Commands:
  list                    List all scheduled tasks
  add                     Add a new scheduled task
  pause <id|name>         Pause a scheduled task
  resume <id|name>        Resume a paused task
  delete <id|name>        Delete a scheduled task
  trigger <id|name>       Manually trigger a task
  history <id|name>       View execution history
  status                  Show scheduler status

Examples:
  hive cron add --name "daily-report" --task "Generate daily report" --type recurring --cron "0 9 * * *" --payload '{"prompt":"Generate daily report"}'
  hive cron add --name "reminder" --task "Send reminder" --type one_shot --fire-at "2026-04-01T09:00:00" --agent "work-agent"
  hive cron list --status active
  hive cron pause daily-report
  hive cron trigger daily-report
  hive cron history daily-report
`);
  }
}

async function listCron(args: string[]): Promise<void> {
  const statusFilter = args.find((a) => a.startsWith("--status="))?.split("=")[1];
  const typeFilter = args.find((a) => a.startsWith("--type="))?.split("=")[1];

  try {
    let path = "/api/cron";
    const params = new URLSearchParams();
    if (statusFilter) params.append("status", statusFilter);
    if (typeFilter) params.append("task_type", typeFilter);
    if (params.toString()) path += `?${params.toString()}`;

    const result = await apiRequest(path);

    if (!result.tasks || result.tasks.length === 0) {
      console.log("No scheduled tasks found");
      return;
    }

    console.log("\n⏰ Scheduled Tasks:\n");

    for (const task of result.tasks) {
      const statusIcon = getStatusIcon(task.status);
      const typeIcon = task.task_type === "recurring" ? "🔄" : "📅";
      
      console.log(`  ${typeIcon} ${task.name} (${task.id})`);
      console.log(`    Status:      ${statusIcon} ${task.status}`);
      console.log(`    Type:        ${task.task_type}`);
      
      if (task.task_type === "recurring") {
        console.log(`    Cron:        ${task.cron_expression}`);
      } else {
        console.log(`    Fire at:     ${task.fire_at}`);
      }
      
      if (task.next_run) {
        console.log(`    Next run:    ${formatDate(task.next_run)}`);
      }
      
      if (task.last_run_at) {
        console.log(`    Last run:    ${formatDate(task.last_run_at)}`);
      }
      
      console.log(`    Run count:   ${task.run_count}`);
      console.log(`    Channel:     ${task.channel}`);
      
      if (task.last_error) {
        console.log(`    Last error:  ${task.last_error}`);
      }
      
      console.log();
    }

    console.log(`Total: ${result.count} task(s)\n`);
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
  }
}

async function addCron(args: string[]): Promise<void> {
  // Parse arguments
  const parseArg = (name: string): string | undefined => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg?.split("=").slice(1).join("=");
  };

  const name = parseArg("name");
  const type = parseArg("type") as "recurring" | "one_shot" | undefined;
  const cron = parseArg("cron");
  const fireAt = parseArg("fire-at");
  const agent = parseArg("agent");
  const tool = parseArg("tool");
  const payloadStr = parseArg("payload");
  const channel = parseArg("channel");
  const tz = parseArg("tz");
  const maxRuns = parseArg("max-runs");
  const interval = parseArg("interval");
  const task = parseArg("task");
  const startAt = parseArg("start-at");
  const stopAt = parseArg("stop-at");
  const domAndDow = parseArg("dom-and-dow");

  // Interactive mode if missing required args
  if (!name) {
    const nameValue = await p.text({
      message: "Task name:",
      placeholder: "daily-report",
      validate: (v) => (!v ? "Name is required" : undefined),
    });

    if (p.isCancel(nameValue)) {
      p.cancel("Cancelled");
      return;
    }

    args.push(`--name=${nameValue}`);
    return addCron(args);
  }

  if (!task) {
    const taskValue = await p.text({
      message: "Task instruction (what should the cron do):",
      placeholder: "Generate daily report",
      validate: (v) => (!v ? "Task is required" : undefined),
    });

    if (p.isCancel(taskValue)) {
      p.cancel("Cancelled");
      return;
    }

    args.push(`--task=${taskValue}`);
    return addCron(args);
  }

  if (!type) {
    const typeValue = await p.select({
      message: "Task type:",
      options: [
        { value: "recurring", label: "Recurring (cron-based)" },
        { value: "one_shot", label: "One-shot (single execution)" },
      ],
    });

    if (p.isCancel(typeValue)) {
      p.cancel("Cancelled");
      return;
    }

    args.push(`--type=${typeValue}`);
    return addCron(args);
  }

  if (type === "recurring" && !cron) {
    const cronValue = await p.text({
      message: "Cron expression (5 fields: min hour day month weekday):",
      placeholder: "0 9 * * *",
      validate: (v) => (!v ? "Cron expression is required for recurring tasks" : undefined),
    });

    if (p.isCancel(cronValue)) {
      p.cancel("Cancelled");
      return;
    }

    args.push(`--cron=${cronValue}`);
    return addCron(args);
  }

  if (type === "one_shot" && !fireAt) {
    const fireAtValue = await p.text({
      message: "Fire at (ISO 8601 format):",
      placeholder: "2026-04-01T09:00:00",
      validate: (v) => {
        if (!v) return "Fire at is required for one-shot tasks";
        const date = new Date(v);
        if (isNaN(date.getTime())) return "Invalid date format";
        if (date.getTime() <= Date.now()) return "Date must be in the future";
        return undefined;
      },
    });

    if (p.isCancel(fireAtValue)) {
      p.cancel("Cancelled");
      return;
    }

    args.push(`--fire-at=${fireAtValue}`);
    return addCron(args);
  }

  // Build payload
  let payload: Record<string, unknown> = {};
  if (payloadStr) {
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      console.error(`❌ Invalid payload JSON: ${payloadStr}`);
      return;
    }
  } else {
    const promptValue = await p.text({
      message: "Task prompt/message:",
      placeholder: "Generate daily report",
      validate: (v) => (!v ? "Prompt is required" : undefined),
    });

    if (p.isCancel(promptValue)) {
      p.cancel("Cancelled");
      return;
    }

    payload = { prompt: promptValue };
  }

  try {
    const timezone = tz || getUserTimezone();

    const body: Record<string, unknown> = {
      name,
      task_type: type,
      timezone,
      payload,
      channel: channel || "system",
    };

    if (type === "recurring") {
      body.cron_expression = cron;
    } else {
      body.fire_at = fireAt;
    }

    if (agent) body.agent_id = agent;
    if (tool) body.tool_name = tool;
    if (maxRuns) body.max_runs = parseInt(maxRuns, 10);
    if (interval) body.interval_sec = parseInt(interval, 10);
    if (startAt) body.start_at = startAt;
    if (stopAt) body.stop_at = stopAt;
    if (domAndDow) body.dom_and_dow = parseInt(domAndDow, 10);
    body.task = task;

    const result = await apiRequest("/api/cron", {
      method: "POST",
      body: JSON.stringify(body),
    });

    console.log(`✅ Task "${name}" created: ${result.task_id}`);
    if (result.next_run) {
      console.log(`   Next run: ${formatDate(result.next_run)}`);
    }
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
  }
}

async function cronAction(action: string, id: string | undefined): Promise<void> {
  if (!id) {
    console.log(`❌ Specify task ID: hive cron ${action} <id|name>`);
    return;
  }

  try {
    // First try to find by ID, then by name
    let taskId = id;
    try {
      const result = await apiRequest(`/api/cron/${id}`);
      taskId = result.task.id;
    } catch {
      // Not found by ID, try by name
      const listResult = await apiRequest("/api/cron");
      const task = listResult.tasks.find((t: any) => t.name === id);
      if (!task) {
        console.error(`❌ Task not found: ${id}`);
        return;
      }
      taskId = task.id;
    }

    let path = `/api/cron/${taskId}`;
    let method = "POST";

    if (action === "trigger") {
      path += "/trigger";
    } else if (action === "delete") {
      method = "DELETE";
    } else {
      path += `/${action}`;
    }

    await apiRequest(path, { method });

    console.log(`✅ Task "${id}" ${action}d`);
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
  }
}

async function cronHistory(id: string | undefined): Promise<void> {
  if (!id) {
    console.log("❌ Specify task ID: hive cron history <id|name>");
    return;
  }

  try {
    // Find task by ID or name
    let taskId = id;
    try {
      const result = await apiRequest(`/api/cron/${id}`);
      taskId = result.task.id;
    } catch {
      const listResult = await apiRequest("/api/cron");
      const task = listResult.tasks.find((t: any) => t.name === id);
      if (!task) {
        console.error(`❌ Task not found: ${id}`);
        return;
      }
      taskId = task.id;
    }

    const result = await apiRequest(`/api/cron/${taskId}/history?limit=20`);

    if (!result.history || result.history.length === 0) {
      console.log("No execution history found");
      return;
    }

    console.log(`\n📜 Execution History for "${id}":\n`);

    for (const run of result.history) {
      const statusIcon = getRunStatusIcon(run.status);
      const duration = run.duration_ms ? `${Math.round(run.duration_ms)}ms` : "N/A";
      
      console.log(`  ${statusIcon} Run ${run.id}`);
      console.log(`    Status:    ${run.status}`);
      console.log(`    Started:   ${formatDate(run.started_at)}`);
      console.log(`    Duration:  ${duration}`);
      
      if (run.error_message) {
        console.log(`    Error:     ${run.error_message}`);
      }
      
      console.log();
    }
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
  }
}

async function cronStatus(): Promise<void> {
  try {
    const result = await apiRequest("/api/cron/status");

    if (!result.status || result.status.length === 0) {
      console.log("No active scheduler tasks");
      return;
    }

    console.log("\n📊 Scheduler Status:\n");

    for (const task of result.status) {
      const busyIcon = task.isBusy ? "🔄" : "⏸️";
      
      console.log(`  ${busyIcon} ${task.name} (${task.id})`);
      console.log(`    Status:     ${task.status}`);
      console.log(`    Next run:   ${task.nextRun ? formatDate(task.nextRun) : "N/A"}`);
      console.log(`    Is busy:    ${task.isBusy ? "Yes" : "No"}`);
      console.log();
    }
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "active": return "✅";
    case "paused": return "⏸️";
    case "completed": return "✔️";
    case "failed": return "❌";
    case "cancelled": return "🚫";
    default: return "❓";
  }
}

function getRunStatusIcon(status: string): string {
  switch (status) {
    case "running": return "🔄";
    case "success": return "✅";
    case "failed": return "❌";
    case "timeout": return "⏱️";
    default: return "❓";
  }
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}
