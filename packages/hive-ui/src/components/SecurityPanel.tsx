import { useEffect, useState } from "react";
import {
  Check, Copy, Eye, EyeOff, KeyRound, Loader2, LockKeyhole,
  ShieldCheck, ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import { swal } from "@/lib/swal";

type SecurityPanelProps = {
  email: string;
  profileEditing?: boolean;
};

export function SecurityPanel({ email, profileEditing = false }: SecurityPanelProps) {
  const [hasCredentials, setHasCredentials] = useState(false);
  const [credentialEmail, setCredentialEmail] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [open, setOpen] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [copied, setCopied] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      const data = await apiClient<{ hasCredentials: boolean; email: string | null }>("/api/auth/status");
      setHasCredentials(data.hasCredentials);
      setCredentialEmail(data.email ?? "");
    } catch {
      // The profile remains usable if the access-status check is unavailable.
    } finally {
      setLoadingStatus(false);
    }
  }

  async function openSecurityModal() {
    if (profileEditing) return;
    setOpen(true);
    try {
      const data = await apiClient<{ recoveryKey: string }>("/api/auth/recovery-key");
      setRecoveryKey(data.recoveryKey);
    } catch {
      // Password management still works without displaying the recovery key.
    }
  }

  function resetPasswordFields() {
    setPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
  }

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      await swal.fire({ icon: "error", title: "Error", text: "Las contraseñas no coinciden" });
      return;
    }
    if (password.length < 8) {
      await swal.fire({ icon: "error", title: "Error", text: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }

    setSaving(true);
    try {
      if (hasCredentials) {
        await apiClient("/api/auth/change-password", {
          method: "POST",
          body: { currentPassword, newPassword: password },
        });
      } else {
        await apiClient("/api/auth/setup-credentials", {
          method: "POST",
          body: { password },
        });
      }
      await swal.fire({
        icon: "success",
        title: hasCredentials ? "Contraseña actualizada" : "Protección activada",
        timer: 2200,
        showConfirmButton: false,
        toast: true,
        position: "top-end",
      });
      resetPasswordFields();
      setOpen(false);
      await loadStatus();
    } catch {
      // apiClient presents the server error.
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    const result = await swal.fire({
      title: "¿Desactivar protección?",
      text: "Cualquiera con acceso a la URL podrá usar Hive sin contraseña.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, desactivar",
      cancelButtonText: "Cancelar",
    });
    if (!result.isConfirmed) return;

    try {
      await apiClient("/api/auth/disable", { method: "POST" });
      await swal.fire({
        icon: "success",
        title: "Protección desactivada",
        timer: 1800,
        showConfirmButton: false,
        toast: true,
        position: "top-end",
      });
      setHasCredentials(false);
      setCredentialEmail("");
      resetPasswordFields();
      setOpen(false);
    } catch {
      // apiClient presents the server error.
    }
  }

  async function copyRecoveryKey() {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const visibleEmail = credentialEmail || email.trim().toLowerCase();

  return (
    <>
      <div
        className="flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between"
        style={{
          background: "hsl(var(--hive-glass))",
          borderColor: hasCredentials
            ? "hsl(var(--hive-green) / 0.25)"
            : "hsl(var(--hive-border-base))",
        }}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="mt-0.5 rounded-lg border p-2"
            style={{
              color: hasCredentials ? "hsl(var(--hive-green))" : "hsl(var(--hive-amber))",
              background: hasCredentials
                ? "hsl(var(--hive-green) / 0.08)"
                : "hsl(var(--hive-amber) / 0.08)",
              borderColor: hasCredentials
                ? "hsl(var(--hive-green) / 0.18)"
                : "hsl(var(--hive-amber) / 0.18)",
            }}
          >
            {hasCredentials
              ? <ShieldCheck className="h-4 w-4" />
              : <ShieldOff className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white">Acceso con contraseña</p>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: "hsl(var(--hive-text-muted))" }}>
              {loadingStatus
                ? "Comprobando protección…"
                : hasCredentials
                  ? `Protegido · ${visibleEmail}`
                  : visibleEmail
                    ? `Sin contraseña · ${visibleEmail}`
                    : "Guarda un correo válido para activar la protección"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void openSecurityModal()}
          disabled={loadingStatus || profileEditing || !visibleEmail}
          className="flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          style={{
            background: "hsl(var(--hive-amber) / 0.12)",
            border: "1px solid hsl(var(--hive-amber) / 0.3)",
            color: "hsl(var(--hive-amber))",
          }}
        >
          <KeyRound className="h-3.5 w-3.5" />
          {profileEditing
            ? "Guarda el perfil primero"
            : hasCredentials
              ? "Gestionar acceso"
              : "Crear contraseña"}
        </button>
      </div>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetPasswordFields();
      }}>
        <DialogContent
          className="overflow-hidden rounded-2xl p-0"
          style={{
            background: "hsl(var(--hive-surface))",
            borderColor: "hsl(var(--hive-border-base))",
          }}
        >
          <div
            className="border-b px-6 py-5"
            style={{
              background: "linear-gradient(135deg, hsl(var(--hive-amber) / 0.12), transparent 65%)",
              borderColor: "hsl(var(--hive-border-subtle))",
            }}
          >
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border"
                style={{
                  color: "hsl(var(--hive-amber))",
                  background: "hsl(var(--hive-amber) / 0.1)",
                  borderColor: "hsl(var(--hive-amber) / 0.25)",
                }}>
                <LockKeyhole className="h-5 w-5" />
              </div>
              <DialogTitle>
                {hasCredentials ? "Cambiar contraseña" : "Proteger tu instancia"}
              </DialogTitle>
              <DialogDescription>
                Tu identidad de acceso será <span className="font-semibold text-foreground">{visibleEmail}</span>.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4 px-6 pb-6">
            {hasCredentials && (
              <div className="space-y-2">
                <Label htmlFor="profile-current-password">Contraseña actual</Label>
                <div className="relative">
                  <Input
                    id="profile-current-password"
                    type={showCurrent ? "text" : "password"}
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                    disabled={saving}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showCurrent ? "Ocultar contraseña actual" : "Mostrar contraseña actual"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowCurrent((value) => !value)}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="profile-new-password">
                {hasCredentials ? "Nueva contraseña" : "Contraseña"}
              </Label>
              <div className="relative">
                <Input
                  id="profile-new-password"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                  disabled={saving}
                  className="pr-10"
                />
                <button
                  type="button"
                  aria-label={showNew ? "Ocultar contraseña nueva" : "Mostrar contraseña nueva"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowNew((value) => !value)}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-confirm-password">Confirmar contraseña</Label>
              <Input
                id="profile-confirm-password"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
                disabled={saving}
              />
            </div>

            {recoveryKey && (
              <div className="rounded-xl border p-3" style={{
                background: "hsl(var(--hive-glass))",
                borderColor: "hsl(var(--hive-border-subtle))",
              }}>
                <p className="text-[11px] font-bold">Clave de recuperación</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Guárdala fuera de este equipo por si olvidas tu contraseña.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-black/20 px-2.5 py-2 text-[10px]">
                    {recoveryKey}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Copiar clave de recuperación"
                    onClick={() => void copyRecoveryKey()}
                  >
                    {copied
                      ? <Check className="h-4 w-4 text-green-500" />
                      : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 pt-1 sm:justify-between">
              {hasCredentials ? (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => void handleDisable()} disabled={saving}>
                  Desactivar protección
                </Button>
              ) : <span />}
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasCredentials ? "Actualizar contraseña" : "Activar protección"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
