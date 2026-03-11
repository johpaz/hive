import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { AppLayout } from "@/modules/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AgentNewPage } from "@/pages/AgentNewPage";
import { CanvasPage } from "@/pages/CanvasPage";
import { BridgePage } from "@/pages/BridgePage";
import { LogsPage } from "@/pages/LogsPage";
import { ChannelsPage } from "@/pages/ChannelsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProvidersPage } from "@/pages/ProvidersPage";
import { WebChatPage } from "@/pages/WebChatPage";
import SetupPage from "@/pages/SetupPage";
import NotFound from "@/pages/NotFound";
import { useInitializeGlobalConfig } from "@/stores/useGlobalConfigStore";
import { useUserStore } from "@/stores/userStore";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { useEffect, useState } from "react";
import { BeeLoader } from "@/components/ui/bee-loader";


const queryClient = new QueryClient();

const AppContent = () => {
  useInitializeGlobalConfig();

  const fetchUser = useUserStore(s => s.fetchUser);
  const navigate = useNavigate();
  const location = useLocation();
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
    // Capturar token de la URL si existe
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      localStorage.setItem("hive-auth-token", token);
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    // Verificar si el setup está completo y redirigir según corresponda
    fetch("/api/setup/status")
      .then(r => r.json())
      .then(({ setupMode }) => {
        if (setupMode && location.pathname !== "/setup") {
          // Primera ejecución → ir al setup
          navigate("/setup", { replace: true });
        } else if (!setupMode && location.pathname === "/setup") {
          // Ya configurado y el usuario navegó a /setup manualmente → al dashboard
          navigate("/", { replace: true });
        }
        setSetupChecked(true);
        if (!setupMode) fetchUser();
      })
      .catch(() => {
        // Si el gateway no responde todavía, dejamos que el usuario vea lo que hay
        setSetupChecked(true);
        fetchUser();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No renderizar nada hasta saber si hay que redirigir (evita flash)
  if (!setupChecked) return null;

  return (
    <>
      <BeeLoader />
      <WelcomeDialog />

      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<AppLayout />}>
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/bridge" element={<BridgePage />} />
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
