import { ConnectionStatus } from "./ConnectionStatus";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function Header() {
  return (
    <header className="sticky top-0 w-full flex h-12 shrink-0 items-center justify-between border-b border-border bg-background z-50 px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="h-8 w-8" />
        <div className="flex items-center gap-2">
          <img
            src="/logocolor-dark.png"
            alt="Hive"
            className="h-8 w-8 object-contain"
          />
          <h1 className="text-sm font-semibold tracking-tight">Hive</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionStatus />
      </div>
    </header>
  );
}
