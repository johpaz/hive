import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, Loader2, Copy, Check, ShieldCheck, ShieldOff } from "lucide-react";
import { apiClient } from "@/lib/api";
import { swal } from "@/lib/swal";

type View = "status" | "enable" | "change-password";

export function SecurityPanel() {
  const [hasCredentials, setHasCredentials] = useState(false);
  const [credentialEmail, setCredentialEmail] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [view, setView] = useState<View>("status");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [copied, setCopied] = useState(false);

  // Enable form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingSaving, setChangingSaving] = useState(false);

  useEffect(() => {
    loadStatus();
    loadRecoveryKey();
  }, []);

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      const data = await fetch("/api/auth/status").then(r => r.json());
      setHasCredentials(data.hasCredentials);
      if (data.email) setCredentialEmail(data.email);
    } catch {/* ignore */} finally {
      setLoadingStatus(false);
    }
  }

  async function loadRecoveryKey() {
    try {
      const data = await apiClient<{ recoveryKey: string }>("/api/auth/recovery-key");
      setRecoveryKey(data.recoveryKey);
    } catch {/* ignore */}
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      swal.fire({ icon: "error", title: "Error", text: "Las contraseñas no coinciden" });
      return;
    }
    if (password.length < 8) {
      swal.fire({ icon: "error", title: "Error", text: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }
    setSaving(true);
    try {
      await apiClient("/api/auth/setup-credentials", {
        method: "POST",
        body: { email, password },
      });
      swal.fire({ icon: "success", title: "Protección activada", text: "La próxima vez que accedas necesitarás tu email y contraseña.", timer: 3000, showConfirmButton: false, toast: true, position: "top-end" });
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setView("status");
      await loadStatus();
    } catch {/* apiClient already shows error */} finally {
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
      swal.fire({ icon: "success", title: "Protección desactivada", timer: 2000, showConfirmButton: false, toast: true, position: "top-end" });
      setHasCredentials(false);
      setCredentialEmail("");
      setView("status");
    } catch {/* ignore */}
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmNew) {
      swal.fire({ icon: "error", title: "Error", text: "Las contraseñas no coinciden" });
      return;
    }
    if (newPassword.length < 8) {
      swal.fire({ icon: "error", title: "Error", text: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }
    setChangingSaving(true);
    try {
      await apiClient("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      swal.fire({ icon: "success", title: "Contraseña actualizada", timer: 2000, showConfirmButton: false, toast: true, position: "top-end" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNew("");
      setView("status");
    } catch {/* ignore */} finally {
      setChangingSaving(false);
    }
  }

  function copyRecoveryKey() {
    if (!recoveryKey) return;
    navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loadingStatus) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>;
  }

  return (
    <div className="space-y-8 max-w-xl">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {hasCredentials
              ? <ShieldCheck className="h-5 w-5 text-green-500" />
              : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
            <span className="font-medium">Protección con contraseña</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasCredentials
              ? `Activa — ${credentialEmail || "credenciales configuradas"}`
              : "Desactivada — acceso libre sin contraseña"}
          </p>
        </div>
        <Switch
          checked={hasCredentials}
          onCheckedChange={checked => {
            if (checked) {
              setView("enable");
            } else {
              handleDisable();
            }
          }}
        />
      </div>

      {/* Enable form */}
      {view === "enable" && !hasCredentials && (
        <form onSubmit={handleEnable} className="space-y-4 border rounded-lg p-4">
          <h3 className="font-medium">Configurar credenciales</h3>

          <div className="space-y-2">
            <Label htmlFor="sec-email">Email</Label>
            <Input id="sec-email" type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} required disabled={saving} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sec-pwd">Contraseña</Label>
            <div className="relative">
              <Input id="sec-pwd" type={showPassword ? "text" : "password"} placeholder="Mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} required disabled={saving} className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sec-confirm">Confirmar contraseña</Label>
            <Input id="sec-confirm" type={showPassword ? "text" : "password"} placeholder="Repite la contraseña" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required disabled={saving} />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activar protección
            </Button>
            <Button type="button" variant="ghost" onClick={() => setView("status")} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {/* Actions when credentials are active */}
      {hasCredentials && view === "status" && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setView("change-password")}>
            Cambiar contraseña
          </Button>
        </div>
      )}

      {/* Change password form */}
      {view === "change-password" && hasCredentials && (
        <form onSubmit={handleChangePassword} className="space-y-4 border rounded-lg p-4">
          <h3 className="font-medium">Cambiar contraseña</h3>

          <div className="space-y-2">
            <Label htmlFor="current-pwd">Contraseña actual</Label>
            <div className="relative">
              <Input id="current-pwd" type={showCurrent ? "text" : "password"} placeholder="••••••••" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required disabled={changingSaving} className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowCurrent(v => !v)} tabIndex={-1}>
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-pwd">Nueva contraseña</Label>
            <div className="relative">
              <Input id="new-pwd" type={showNew ? "text" : "password"} placeholder="Mínimo 8 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} required disabled={changingSaving} className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNew(v => !v)} tabIndex={-1}>
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-new">Confirmar nueva contraseña</Label>
            <Input id="confirm-new" type={showNew ? "text" : "password"} placeholder="••••••••" value={confirmNew} onChange={e => setConfirmNew(e.target.value)} required disabled={changingSaving} />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={changingSaving}>
              {changingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Actualizar contraseña
            </Button>
            <Button type="button" variant="ghost" onClick={() => setView("status")} disabled={changingSaving}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {/* Recovery Key */}
      {recoveryKey && (
        <div className="space-y-2 border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Recovery Key</p>
              <p className="text-xs text-muted-foreground">Úsalo para recuperar el acceso si olvidas tu contraseña</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted rounded px-3 py-2 font-mono break-all">{recoveryKey}</code>
            <Button variant="ghost" size="icon" onClick={copyRecoveryKey} className="shrink-0">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
