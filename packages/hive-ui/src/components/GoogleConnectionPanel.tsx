import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import { apiClient } from "@/lib/api";
import { swal } from "@/lib/swal";
import { isDesktopApp } from "@/stores/useDesktopUpdateStore";
import { GoogleFlowCancelled, connectGoogleExternal } from "@/lib/google-external";

type ServiceAgent = { id: string; name: string; enabled: boolean };

type GoogleStatus = {
  configured: boolean;
  redirectUri?: string;
  availableServices?: string[];
  agents?: Record<string, ServiceAgent>;
  linked?: boolean;
  email?: string | null;
  connected?: boolean;
  services?: string[];
};

const SERVICE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  drive: "Drive",
};

const SERVICE_HINT: Record<string, string> = {
  gmail: "buscar, leer, responder y enviar correos",
  calendar: "ver y crear eventos, revisar disponibilidad",
  drive: "buscar, leer y subir archivos",
};

const ERRORS: Record<string, string> = {
  denied: "Cancelaste la autorización en Google.",
  invalid_state: "La solicitud caducó. Inténtalo de nuevo.",
  exchange_failed: "Google rechazó la autorización. Inténtalo de nuevo.",
  unverified_email: "La cuenta de Google no tiene el correo verificado.",
  other_account: "Ya hay otra cuenta de Google vinculada a este Hive.",
  no_user: "Primero completa tu perfil.",
  not_configured: "Google no está configurado en este servidor.",
  expired: "La solicitud caducó. Inténtalo de nuevo.",
};

/**
 * Aquí se autentica la cuenta de Google: vincula el inicio de sesión y activa
 * los agentes de Gmail, Calendar y Drive que el usuario autorice.
 */
export function GoogleConnectionPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<AbortController | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const s = await apiClient<GoogleStatus>("/api/google/status", { showError: false });
      setStatus(s);
      setSelected((prev) => (prev.length ? prev : s.availableServices ?? []));
    } catch {
      setStatus({ configured: false });
    }
  }

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const err = params.get("google_error");
    if (err) void swal.fire({ icon: "error", title: "Google", text: ERRORS[err] ?? "No se pudo conectar con Google." });
    else if (params.get("google") === "connected") void swal.fire({ icon: "success", title: "Google conectado", text: "Tus agentes de Google ya están activos.", timer: 2500, showConfirmButton: false });
    if (err || params.get("google")) {
      params.delete("google_error");
      params.delete("google");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  if (!status?.configured) return null;

  async function connect() {
    setBusy(true);
    if (isDesktopApp()) {
      // Google no admite WebViews embebidos: se autoriza en el navegador del sistema.
      const ctrl = new AbortController();
      setWaiting(ctrl);
      try {
        const { authToken } = await connectGoogleExternal(selected, ctrl.signal);
        if (authToken) localStorage.setItem("hive-auth-token", authToken);
        await load();
        void swal.fire({ icon: "success", title: "Google conectado", text: "Tus agentes de Google ya están activos.", timer: 2500, showConfirmButton: false });
      } catch (err) {
        if (!(err instanceof GoogleFlowCancelled)) {
          const code = (err as { code?: string }).code ?? "";
          void swal.fire({ icon: "error", title: "Google", text: ERRORS[code] ?? "No se pudo conectar con Google." });
        }
      } finally {
        setWaiting(null);
        setBusy(false);
      }
      return;
    }
    try {
      const { url } = await apiClient<{ url: string }>("/api/google/connect", { method: "POST", body: { services: selected } });
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await swal.fire({
      icon: "warning", title: "¿Desconectar Google?", showCancelButton: true,
      text: "Se desactivarán tus agentes de Gmail, Calendar y Drive y Hive dejará de acceder a tu cuenta. Podrás seguir iniciando sesión con Google.",
      confirmButtonText: "Desconectar", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    setBusy(true);
    try {
      await apiClient("/api/google/disconnect", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copyUri() {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* sin portapapeles: el texto queda visible para copiarlo a mano */ }
  }

  const available = status.availableServices ?? [];
  const granted = new Set(status.services ?? []);
  const toggle = (s: string) => setSelected((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3.5"
      style={{
        background: "hsl(var(--hive-glass))",
        borderColor: status.connected ? "hsl(var(--hive-green) / 0.25)" : "hsl(var(--hive-amber) / 0.3)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border p-2" style={{ color: "hsl(var(--hive-amber))", borderColor: "hsl(var(--hive-amber) / 0.18)" }}>
          <Mail className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-white">Cuenta de Google</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "hsl(var(--hive-text-muted))" }}>
            {status.connected
              ? `Conectada${status.email ? ` · ${status.email}` : ""}`
              : "Conecta tu cuenta para activar los agentes de Google. Sin conectar, permanecen inactivos."}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        {available.map((s) => {
          const agent = status.agents?.[s];
          const on = granted.has(s) && !!agent?.enabled;
          return (
            <label key={s} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <input type="checkbox" className="mt-0.5" checked={selected.includes(s)} onChange={() => toggle(s)} disabled={busy} />
              <span className="min-w-0 flex-1 text-[11px] text-white">
                <span className="font-bold">{SERVICE_LABEL[s] ?? s}</span>
                <span className="text-white/45"> — {SERVICE_HINT[s] ?? ""}</span>
              </span>
              <span
                className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  on ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-white/5 text-white/35"
                }`}
              >
                {agent?.name ?? "Agente"}: {on ? "activo" : "inactivo"}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {waiting && (
          <button type="button" onClick={() => waiting.abort()} className="h-9 rounded-lg px-3 text-[11px] text-white/70 underline">
            Cancelar
          </button>
        )}
        {status.connected && (
          <button type="button" onClick={() => void disconnect()} disabled={busy}
            className="h-9 rounded-lg px-3 text-[11px] font-bold text-red-300 disabled:opacity-45"
            style={{ border: "1px solid hsl(0 70% 50% / 0.3)" }}>
            Desconectar
          </button>
        )}
        <button type="button" onClick={() => void connect()} disabled={busy || selected.length === 0}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold disabled:opacity-45"
          style={{ background: "hsl(var(--hive-amber) / 0.12)", border: "1px solid hsl(var(--hive-amber) / 0.3)", color: "hsl(var(--hive-amber))" }}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {waiting ? "Esperando a Google en tu navegador…" : status.connected ? "Cambiar permisos" : "Conectar con Google"}
        </button>
      </div>

      {status.redirectUri && (
        <div className="border-t border-white/5 pt-2 text-[10px] text-white/35">
          <p>
            ¿Google muestra «redirect_uri_mismatch»? Registra esta URI en las «URI de redirección autorizadas» de tu cliente OAuth:
          </p>
          <button type="button" onClick={() => void copyUri()} className="mt-1 flex max-w-full items-center gap-1.5 rounded bg-black/30 px-2 py-1 text-left font-mono text-[10px] text-white/70 hover:text-white">
            <span className="truncate">{status.redirectUri}</span>
            {copied ? <Check className="h-3 w-3 flex-shrink-0 text-emerald-400" /> : <Copy className="h-3 w-3 flex-shrink-0" />}
          </button>
        </div>
      )}
    </div>
  );
}
