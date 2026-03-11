import { ConnectionStatus } from "./ConnectionStatus";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function Header() {
  return (
    <header className="flex h-12 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="h-8 w-8" />
        <h1 className="text-sm font-semibold tracking-tight">
          <span className="text-primary">⬡</span> Hive
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionStatus />
      </div>
    </header>
  );
}
