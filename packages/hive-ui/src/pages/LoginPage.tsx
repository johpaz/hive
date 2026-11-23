import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { isDesktopApp } from "@/stores/useDesktopUpdateStore";
import { GoogleFlowCancelled, loginWithGoogleExternal } from "@/lib/google-external";

const GOOGLE_ERRORS: Record<string, string> = {
  not_linked: "Esa cuenta de Google no está vinculada a este Hive. Inicia sesión con tu contraseña y vincúlala en tu perfil.",
  denied: "Cancelaste el acceso con Google.",
  invalid_state: "La solicitud caducó. Inténtalo de nuevo.",
  exchange_failed: "Google rechazó la autorización. Inténtalo de nuevo.",
  unverified_email: "La cuenta de Google no tiene el correo verificado.",
  not_configured: "Google no está configurado en este servidor.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="mr-2 h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleLogin, setGoogleLogin] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [waitingGoogle, setWaitingGoogle] = useState<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleCode = params.get("google_code");
    const googleError = params.get("google_error");
    if (googleError) {
      setError(GOOGLE_ERRORS[googleError] ?? "No se pudo iniciar sesión con Google.");
    }
    if (googleCode) {
      // Canje del código de un solo uso que dejó el callback de Google.
      window.history.replaceState({}, "", window.location.pathname);
      setLoading(true);
      fetch("/api/auth/google/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: googleCode }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Código inválido");
          localStorage.setItem("hive-auth-token", data.authToken);
          navigate("/", { replace: true });
        })
        .catch(() => setError("No se pudo completar el inicio de sesión con Google."))
        .finally(() => setLoading(false));
      return;
    }
    // If no credentials configured → open install, go home
    fetch("/api/auth/status")
      .then(r => r.json())
      .then(({ hasCredentials, googleLogin, hasPassword }) => {
        if (!hasCredentials) navigate("/", { replace: true });
        setGoogleLogin(!!googleLogin);
        setHasPassword(hasPassword !== false);
      })
      .catch(() => {/* ignore */});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGoogle() {
    setError("");
    if (!isDesktopApp()) {
      window.location.href = "/api/auth/google/start";
      return;
    }
    // Escritorio: Google no admite WebViews embebidos; se abre el navegador del sistema.
    const ctrl = new AbortController();
    setWaitingGoogle(ctrl);
    try {
      const token = await loginWithGoogleExternal(ctrl.signal);
      localStorage.setItem("hive-auth-token", token);
      navigate("/", { replace: true });
    } catch (err) {
      if (!(err instanceof GoogleFlowCancelled)) {
        const code = (err as { code?: string }).code ?? "";
        setError(GOOGLE_ERRORS[code] ?? "No se pudo iniciar sesión con Google.");
      }
    } finally {
      setWaitingGoogle(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Credenciales inválidas");
        return;
      }
      localStorage.setItem("hive-auth-token", data.authToken);
      navigate("/", { replace: true });
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="text-4xl">🐝</div>
          <h1 className="text-2xl font-bold tracking-tight">Hive</h1>
          <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
        </div>

        {googleLogin && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loading || !!waitingGoogle}
            onClick={() => void handleGoogle()}
          >
            {waitingGoogle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon />}
            {waitingGoogle ? "Esperando a Google en tu navegador…" : "Continuar con Google"}
          </Button>
        )}
        {waitingGoogle && (
          <button type="button" onClick={() => waitingGoogle.abort()}
            className="w-full text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Cancelar
          </button>
        )}
        {googleLogin && hasPassword && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> o con tu contraseña <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {error && !hasPassword && <p className="text-sm text-destructive">{error}</p>}

        {hasPassword && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Iniciar Sesión
          </Button>
        </form>
        )}

        {hasPassword && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate("/recover")}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
