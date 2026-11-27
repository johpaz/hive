/**
 * Archivos que un worker deja escritos durante una tarea y qué hacer con los que
 * una corrección deja obsoletos.
 *
 * Problema que resuelve: el coordinador rechaza un documento y devuelve la tarea
 * (task_revise); el worker genera otro —a menudo con otro nombre— y el rechazado
 * se queda en la carpeta del usuario. Aquí se lleva la cuenta de los archivos de
 * cada tarea (en `TaskDoc.metadata`) y, cuando la corrección entrega reemplazos,
 * los anteriores se apartan a `.rechazados/` (recuperables, no se borran) y se
 * purgan al cabo de unos días.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Tools cuyo resultado trae `ruta` de un documento escrito. */
const WRITERS = /^(office_escribir_|office_editar_)/;

export function isDocumentWriter(toolName: string | undefined): boolean {
  return !!toolName && WRITERS.test(toolName);
}

/** Ruta del archivo escrito si el resultado de la tool es un éxito con `ruta`; null si no. */
export function writtenPathFromResult(toolName: string | undefined, content: string): string | null {
  if (!isDocumentWriter(toolName)) return null;
  if (/["']?ok["']?\s*[:=]\s*false/i.test(content)) return null;
  const m = /["']?ruta["']?\s*[:=]\s*["']?([^"'\n,}]+)/.exec(content);
  const p = m?.[1]?.trim();
  return p && path.isAbsolute(p) ? p : null;
}

export interface TaskFiles { files: string[] }

export function readTaskFiles(metadata: string | null | undefined): string[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as Partial<TaskFiles>;
    return Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

/** Une `files` al metadata existente sin pisar otras claves. */
export function withTaskFiles(metadata: string | null | undefined, files: string[]): string {
  let base: Record<string, unknown> = {};
  try { base = metadata ? JSON.parse(metadata) : {}; } catch { /* metadata no JSON: se reemplaza */ }
  return JSON.stringify({ ...base, files: [...new Set(files)] });
}

export const REJECTED_DIR = ".rechazados";
const PURGE_AFTER_MS = 7 * 24 * 3600 * 1000;

/**
 * Aparta los archivos de intentos anteriores que la corrección ya no usa.
 * Solo actúa si la corrección produjo al menos un archivo (nunca deja al usuario sin documento).
 * Devuelve las rutas movidas.
 */
export function supersedeFiles(previous: string[], current: string[], now = Date.now()): string[] {
  if (current.length === 0) return [];
  const keep = new Set(current.map((p) => path.resolve(p)));
  const moved: string[] = [];
  for (const old of previous) {
    const abs = path.resolve(old);
    if (keep.has(abs)) continue; // sobrescrito en el mismo sitio: ya es la versión nueva
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const dir = path.join(path.dirname(abs), REJECTED_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${now}-${path.basename(abs)}`);
      fs.renameSync(abs, dest);
      moved.push(abs);
      purgeRejected(dir, now);
    } catch { /* un archivo bloqueado no debe romper la entrega */ }
  }
  return moved;
}

function purgeRejected(dir: string, now: number): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      const stamp = Number(name.split("-")[0]);
      if (Number.isFinite(stamp) && now - stamp > PURGE_AFTER_MS) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch { /* nada que purgar */ }
}

export function readOriginThread(metadata: string | null | undefined): string | null {
  try {
    const t = (JSON.parse(metadata ?? "null") as { origin_thread?: unknown } | null)?.origin_thread;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

/** Tareas fallidas/bloqueadas de las que aún se consideran las entregas rechazadas: ventana de 6 h. */
export const REDELEGATION_WINDOW_MS = 6 * 3600 * 1000;

export interface PriorTask { id: string; agent_id: string; status: string; metadata: string | null; updated_at: number }

/**
 * Una tarea nueva que entregó archivos sustituye a las entregas fallidas de la MISMA conversación y el MISMO
 * worker (el coordinador re-delegó con `task_delegate` en vez de `task_revise`). Solo cuentan las tareas
 * `failed`/`blocked`: una `completed` pudo ser un documento distinto y válido, y no se toca.
 */
export function rejectedFilesToSupersede(current: { id: string; agent_id: string; metadata: string | null }, prior: PriorTask[], now = Date.now()): { taskId: string; files: string[] }[] {
  const origin = readOriginThread(current.metadata);
  if (!origin) return [];
  return prior
    .filter((t) => t.id !== current.id && t.agent_id === current.agent_id && (t.status === "failed" || t.status === "blocked")
      && readOriginThread(t.metadata) === origin && now - t.updated_at <= REDELEGATION_WINDOW_MS)
    .map((t) => ({ taskId: t.id, files: readTaskFiles(t.metadata) }))
    .filter((t) => t.files.length > 0);
}
