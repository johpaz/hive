/**
 * Estado compartido del updater de la app de escritorio.
 *
 * Vive en un store porque hay dos entradas al mismo flujo: el aviso automático
 * que aparece solo (DesktopUpdater) y el botón "Buscar actualizaciones" de
 * Ajustes (DesktopUpdateCard). Sin estado compartido, apretar el botón mientras
 * el aviso está abierto dispararía dos descargas de lo mismo.
 *
 * Los plugins de Tauri se importan dinámicamente: en el navegador o en Docker
 * este módulo se carga igual y no debe romper nada.
 */

import { create } from "zustand";

export type UpdatePhase =
  | "idle"          // sin novedad (o todavía sin consultar)
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "up-to-date"    // solo tras un chequeo manual: hay que responderle al usuario
  | "unsupported"   // el formato instalado (.deb/.rpm) no se actualiza solo
  | "error";

type PendingUpdate = {
  version: string;
  notes?: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
};

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

type DesktopUpdateState = {
  phase: UpdatePhase;
  update: PendingUpdate | null;
  percent: number;
  error: string;
  /** "Recordarme después" silencia el aviso automático por el resto de la sesión. */
  dismissed: boolean;
  check: (options?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
  reset: () => void;
};

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * ¿La instalación puede reemplazarse a sí misma? En Linux solo el AppImage
 * puede; un .deb o un .rpm hay que instalarlos a mano. Lo responde el proceso
 * de Tauri (`gateway_info`), que es quien sabe cómo se empaquetó la app.
 */
export async function supportsSelfUpdate(): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ selfUpdate?: boolean }>("gateway_info");
    return info?.selfUpdate !== false;
  } catch {
    return false;
  }
}

export const useDesktopUpdateStore = create<DesktopUpdateState>((set, get) => ({
  phase: "idle",
  update: null,
  percent: 0,
  error: "",
  dismissed: false,

  check: async ({ manual = false } = {}) => {
    if (!isDesktopApp()) return;
    // Un .deb/.rpm no puede instalarse solo: consultar sería prometer algo que
    // después no se puede cumplir.
    if (!(await supportsSelfUpdate())) {
      if (manual) set({ phase: "unsupported" });
      return;
    }
    const { phase, dismissed } = get();
    if (phase === "downloading" || phase === "installing" || phase === "restarting") return;
    if (!manual && (dismissed || phase === "available")) return;

    set({ phase: "checking", error: "" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found) {
        set({ update: found as unknown as PendingUpdate, phase: "available" });
      } else {
        set({ update: null, phase: manual ? "up-to-date" : "idle" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // El chequeo de fondo no interrumpe: solo el manual muestra el error,
      // porque ahí el usuario está esperando una respuesta.
      if (manual) set({ phase: "error", error: message });
      else set({ phase: "idle" });
      console.warn("[updater] no se pudo consultar actualizaciones:", message);
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;

    set({ phase: "downloading", percent: 0, error: "" });
    let total = 0;
    let received = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          // Sin content-length no hay porcentaje honesto: queda indeterminado.
          if (total > 0) set({ percent: Math.min(99, Math.round((received / total) * 100)) });
        } else if (event.event === "Finished") {
          set({ percent: 100, phase: "installing" });
        }
      });

      set({ phase: "restarting" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  dismiss: () => set({ dismissed: true, phase: "idle" }),
  reset: () => set({ phase: "idle", percent: 0, error: "" }),
}));
