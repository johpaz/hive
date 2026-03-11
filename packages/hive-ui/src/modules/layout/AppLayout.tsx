import { Outlet } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Header } from "./Header";
import { AppSidebar } from "./HiveSidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useUserStore } from "@/stores/userStore";
import { useEffect } from "react";

// Workaround for React Router v7 + React 18 type incompatibility
// Using type assertion to bypass the JSX element type mismatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OutletComponent = Outlet as any;

export function AppLayout() {
  const { connect } = useWebSocket();
  const { currentUser, fetchUser } = useUserStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (currentUser?.id) {
      connect(currentUser.id);
    }
  }, [connect, currentUser?.id]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background relative overflow-hidden">
        {/* Ambient Glows Globales */}
        <div className="hive-glow-blob hive-glow-blob--blue -top-20 -left-20 h-[500px] w-[500px] opacity-20" />
        <div className="hive-glow-blob hive-glow-blob--purple -bottom-20 -right-20 h-[500px] w-[500px] opacity-20" />

        <div className="flex flex-1 flex-col overflow-hidden relative z-10">
          <Header />
          <main className="hive-page flex-1 min-h-0 p-4 animate-fade-in flex flex-col overflow-auto">
            <OutletComponent />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
