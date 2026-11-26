/**
 * Conexión de Google en la app de escritorio. Google rechaza OAuth dentro de un WebView
 * embebido, así que el gateway abre el navegador del sistema y esta ventana
 * consulta un ticket hasta que el callback lo resuelve.
 */
import { apiClient } from "@/lib/api";

type TicketResult =
  | { status: "pending" }
  | { status: "done"; purpose: "connect" }
  | { status: "error"; error: string };

const POLL_MS = 1500;
const MAX_MS = 5 * 60_000;

export class GoogleFlowCancelled extends Error {}
export class GoogleFlowError extends Error {
  constructor(public readonly code: string) { super(code); }
}

async function waitForTicket(ticket: string, signal: AbortSignal): Promise<Extract<TicketResult, { status: "done" }>> {
  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new GoogleFlowCancelled();
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await apiClient<TicketResult>(`/api/google/ticket?id=${encodeURIComponent(ticket)}`, { requireAuth: false, showError: false });
    if (res.status === "done") return res;
    if (res.status === "error") throw new GoogleFlowError(res.error);
  }
  throw new GoogleFlowError("expired");
}

/** Conecta Gmail/Calendar/Drive desde la ventana de escritorio. No cambia el acceso a Hive. */
export async function connectGoogleExternal(services: string[], signal: AbortSignal): Promise<void> {
  const { ticket } = await apiClient<{ ticket: string }>("/api/google/connect", {
    method: "POST", body: { services, external: true }, showError: false,
  });
  await waitForTicket(ticket, signal);
}
