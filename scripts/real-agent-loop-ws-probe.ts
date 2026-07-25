export {};

const GATEWAY = "http://127.0.0.1:18790";
const WS_GATEWAY = "ws://127.0.0.1:18790/ws";
const TOKEN_PATH = "/home/johnpaez/.hive-dev/.auth_token";
const TARGET_AGENTS = new Set(["api_operator", "browser_operator"]);
const targetTaskIds = new Set(
  (process.env.HIVE_PROBE_TASK_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
);
const observeOnly = process.env.HIVE_PROBE_OBSERVE_ONLY === "1";
const TERMINAL = new Set(["completed", "failed", "blocked", "cancelled"]);
const MAX_RUNTIME_MS = 10 * 60_000;
const NOTICE_GRACE_MS = 45_000;

const prompt = `
Esta es una prueba E2E real del harness de larga duración. Ejecutá exactamente dos
delegaciones independientes en paralelo usando task_delegate con mode="async":

1. worker_id="api_operator": hacer un único GET idempotente a
   https://httpbin.org/get?hive_probe=api-20260724, comprobar HTTP 200 y que el
   JSON devuelto contiene args.hive_probe="api-20260724".
2. worker_id="browser_operator": navegar a https://example.com/, extraer y
   comprobar el título exacto "Example Domain" y producir una captura administrada
   como evidencia (artifact_id; no pedir ni crear un archivo en el workspace).

Para cada delegación incluí criterios de aceptación verificables. No hagas vos el
trabajo de los workers. Informá que quedan en background solo si task_delegate
devuelve task_id/job_id/run_id reales. No afirmes que terminaron en esta primera
respuesta. Cuando lleguen resultados automáticos, comunicá solamente lo que haya
sido autorizado por acceptance_verifier; si una tarea falla o es rechazada,
decilo explícitamente. Narra de forma factual las fases y herramientas usadas.
`.trim();

type Task = {
  id: string;
  agent_id: string;
  status: string;
  job_id?: string | null;
  run_id?: string | null;
  error?: string | null;
  result?: unknown;
  created_at: number;
  updated_at: number;
};

const startedAt = Date.now();
const token = (await Bun.file(TOKEN_PATH).text()).trim();
if (!token) throw new Error("Missing gateway auth token");

function emit(kind: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: Date.now(), kind, ...data }));
}

async function getTasks(): Promise<Task[]> {
  const response = await fetch(`${GATEWAY}/api/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`GET /api/tasks failed: ${response.status}`);
  const body = await response.json() as { tasks?: Task[] };
  return body.tasks ?? [];
}

let terminalSince: number | null = null;
let lastTaskSnapshot = "";
let finished = false;
let connectedSession = "";
const chunks = new Map<string, string>();

const ws = new WebSocket(`${WS_GATEWAY}?token=${encodeURIComponent(token)}`);

const watchdog = setTimeout(() => {
  emit("probe_timeout", { maxRuntimeMs: MAX_RUNTIME_MS });
  finished = true;
  ws.close();
}, MAX_RUNTIME_MS);

const poller = setInterval(async () => {
  try {
    const observed = (await getTasks())
      .filter((task) =>
        TARGET_AGENTS.has(task.agent_id)
        && (targetTaskIds.size > 0
          ? targetTaskIds.has(task.id)
          : task.created_at >= startedAt - 5_000)
      )
      .sort((a, b) => a.created_at - b.created_at);

    const snapshot = JSON.stringify(observed.map((task) => ({
      id: task.id,
      agentId: task.agent_id,
      status: task.status,
      jobId: task.job_id,
      runId: task.run_id,
      error: task.error,
      updatedAt: task.updated_at,
    })));
    if (snapshot !== lastTaskSnapshot) {
      lastTaskSnapshot = snapshot;
      emit("task_snapshot", { tasks: JSON.parse(snapshot) });
    }

    if (
      observed.length === 2
      && observed.every((task) => TERMINAL.has(task.status))
    ) {
      terminalSince ??= Date.now();
      if (Date.now() - terminalSince >= NOTICE_GRACE_MS) {
        emit("probe_complete", {
          tasks: observed.map((task) => ({
            id: task.id,
            agentId: task.agent_id,
            status: task.status,
            jobId: task.job_id,
            runId: task.run_id,
            error: task.error,
          })),
        });
        finished = true;
        ws.close();
      }
    } else {
      terminalSince = null;
    }
  } catch (error) {
    emit("poll_error", { error: (error as Error).message });
  }
}, 3_000);

ws.onopen = () => emit("ws_open");

ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data)) as Record<string, any>;

  if (message.type === "welcome") {
    connectedSession = String(message.sessionId);
    emit("ws_welcome", {
      sessionId: connectedSession,
      agent: message.agent,
    });
    ws.send(JSON.stringify({ type: "logs_subscribe", sessionId: connectedSession }));
    ws.send(JSON.stringify({ type: "canvas_subscribe", sessionId: connectedSession }));
    if (observeOnly) {
      emit("observer_ready", { sessionId: connectedSession, targetTaskIds: [...targetTaskIds] });
      return;
    }
    ws.send(JSON.stringify({
      type: "message",
      sessionId: connectedSession,
      content: prompt,
      timestamp: new Date().toISOString(),
    }));
    emit("user_message_sent", { sessionId: connectedSession, chars: prompt.length });
    return;
  }

  if (message.type === "status") {
    emit("ws_status", { sessionId: message.sessionId, status: message.status });
    return;
  }

  if (message.type === "process") {
    emit("narration", {
      processKind: message.processKind,
      processStatus: message.processStatus,
      label: message.label,
      summary: message.summary,
    });
    return;
  }

  if (message.type === "log") {
    const entry = message.logEntry ?? {};
    const text = String(entry.message ?? "");
    if (/(worker_task|task_delegate|acceptance-verifier|delegation-notify|agent-loop|durable-queue|api_operator|browser_operator)/i.test(text)) {
      emit("gateway_log", {
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
        message: text,
      });
    }
    return;
  }

  if (message.type === "canvas:node_update") {
    const nodeId = message.data?.nodeId;
    if (nodeId === "830ef5445a52430bb422d946dffd39b4" || TARGET_AGENTS.has(nodeId) || nodeId === "acceptance_verifier") {
      emit("agent_state", { agentId: nodeId, changes: message.data?.changes });
    }
    return;
  }

  if (message.type === "message" && message.isChunk) {
    const id = String(message.id ?? "unknown");
    chunks.set(id, (chunks.get(id) ?? "") + String(message.content ?? ""));
    return;
  }

  if (message.type === "typing" && message.isTyping === false) {
    for (const [id, content] of chunks) {
      if (content) emit("assistant_response", { id, content });
    }
    chunks.clear();
    return;
  }

  if (message.type === "progress") {
    emit("channel_delivery", { content: message.content });
    return;
  }

  if (message.type === "error") {
    emit("ws_error_frame", { error: message.error });
  }
};

ws.onerror = () => emit("ws_transport_error");
ws.onclose = () => {
  clearTimeout(watchdog);
  clearInterval(poller);
  emit("ws_close", { finished });
  process.exit(finished ? 0 : 1);
};
