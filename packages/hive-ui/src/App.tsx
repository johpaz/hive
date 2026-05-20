import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppLayout } from "@/modules/layout/AppLayout";


const DashboardPage = lazy(() => import("@/pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import("@/pages/AgentsPage").then(m => ({ default: m.AgentsPage })));
const AgentDetailPage = lazy(() => import("@/pages/AgentDetailPage").then(m => ({ default: m.AgentDetailPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const AgentNewPage = lazy(() => import("@/pages/AgentNewPage").then(m => ({ default: m.AgentNewPage })));
const CanvasPage = lazy(() => import("@/pages/CanvasPage").then(m => ({ default: m.CanvasPage })));
const LogsPage = lazy(() => import("@/pages/LogsPage").then(m => ({ default: m.LogsPage })));
const ChannelsPage = lazy(() => import("@/pages/ChannelsPage").then(m => ({ default: m.ChannelsPage })));
const ProvidersPage = lazy(() => import("@/pages/ProvidersPage").then(m => ({ default: m.ProvidersPage })));
const WebChatPage = lazy(() => import("@/pages/WebChatPage").then(m => ({ default: m.WebChatPage })));
const MeetingPage = lazy(() => import("@/pages/MeetingPage").then(m => ({ default: m.MeetingPage })));
const SetupPage = lazy(() => import("@/pages/SetupPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RecoverPage = lazy(() => import("@/pages/RecoverPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
import { useInitializeGlobalConfig } from "@/stores/useGlobalConfigStore";
import { useUserStore } from "@/stores/userStore";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { useEffect, useState, type ReactNode } from "react";
import { BeeLoader } from "@/components/ui/bee-loader";
import { getApiBaseUrl } from "@/lib/gateway-url";


const queryClient = new QueryClient();

function AuthGuard({ children }: { children: ReactNode }) {
  const token = localStorage.getItem("hive-auth-token");
  const [status, setStatus] = useState<"loading" | "protected" | "open">("loading");

  useEffect(() => {
    fetch("/api/auth/status")
      .then(r => r.json())
      .then(d => setStatus(d.hasCredentials ? "protected" : "open"))
      .catch(() => setStatus("open"));
  }, []);

  if (status === "loading") return null;
  if (status === "open") return <>{children}</>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const AppContent = () => {
  const fetchUser = useUserStore(s => s.fetchUser);
  const navigate = useNavigate();
  const location = useLocation();
  const [gatewayReady, setGatewayReady] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);

  // Only initialize global config when NOT in setup mode and gateway is ready
  useInitializeGlobalConfig(!isSetupMode && setupChecked && gatewayReady);

  // Phase 1: wait for the gateway to finish initializing before doing anything
  useEffect(() => {
    let cancelled = false;
    const healthUrl = `${getApiBaseUrl()}/health`;
    async function waitForGateway() {
      while (!cancelled) {
        try {
          const res = await fetch(healthUrl);
          const d = await res.json().catch(() => ({}));
          if (d.status === "ok") { setGatewayReady(true); return; }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    waitForGateway();
    return () => { cancelled = true; };
  }, []);

  // Phase 2: once gateway is ready, check setup status
  useEffect(() => {
    if (!gatewayReady) return;

    // Capturar token de la URL si existe
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      localStorage.setItem("hive-auth-token", token);
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    fetch("/api/setup/status")
      .then(r => r.json())
      .then(({ setupMode }) => {
        setIsSetupMode(!!setupMode);
        if (setupMode && location.pathname !== "/setup") {
          navigate("/setup", { replace: true });
        } else if (!setupMode && location.pathname === "/setup") {
          navigate("/", { replace: true });
        }
        setSetupChecked(true);
        if (!setupMode) {
          const existingToken = localStorage.getItem("hive-auth-token");
          if (existingToken) fetchUser();
          // Sin token: AuthGuard redirige a /login; fetchUser no aplica aún
        }
      })
      .catch(() => {
        setSetupChecked(true);
        const existingToken = localStorage.getItem("hive-auth-token");
        if (existingToken) fetchUser();
      });
  }, [gatewayReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Block rendering until gateway is ready — show the bee while waiting
  if (!gatewayReady || !setupChecked) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/60 backdrop-blur-md">
        <div className="relative h-32 w-32 animate-bounce" style={{ animationDuration: "2000ms" }}>
          <svg viewBox="0 0 100 100" className="h-full w-full" style={{ filter: "drop-shadow(0 0 15px rgba(245,158,11,0.5))" }}>
            <ellipse cx="50" cy="55" rx="20" ry="15" fill="#F59E0B" />
            <path d="M40 45 Q50 40 60 45" fill="none" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
            <path d="M35 55 Q50 50 65 55" fill="none" stroke="#1F2937" strokeWidth="3" />
            <path d="M40 65 Q50 60 60 65" fill="none" stroke="#1F2937" strokeWidth="2" />
            <circle cx="68" cy="50" r="8" fill="#F59E0B" />
            <circle cx="72" cy="48" r="1.5" fill="#1F2937" />
            <path d="M70 42 Q75 35 80 38" fill="none" stroke="#1F2937" strokeWidth="1" />
            <path d="M68 42 Q65 35 60 38" fill="none" stroke="#1F2937" strokeWidth="1" />
            <path d="M30 55 L20 55" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <p className="mt-8 text-lg font-medium tracking-wide text-primary animate-pulse italic">
          {!gatewayReady ? "Iniciando la colmena..." : "Sincronizando..."}
        </p>
      </div>
    );
  }

  return (
    <>
      <BeeLoader />
      <WelcomeDialog />

      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chat" element={<WebChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentNewPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/notas" element={<SettingsPage forcePanel="notas" />} />
          <Route path="/cron-jobs" element={<SettingsPage forcePanel="cron-jobs" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:panel" element={<SettingsPage />} />
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/canvas/:sessionId" element={<CanvasPage />} />
          <Route path="/meeting" element={<MeetingPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
