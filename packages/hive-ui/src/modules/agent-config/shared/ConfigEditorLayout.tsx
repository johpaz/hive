import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import type { SaveStatus } from "@/types";

interface ConfigEditorLayoutProps {
  title: string;
  icon?: ReactNode;
  saveStatus?: SaveStatus;
  children: ReactNode;
  actions?: ReactNode;
}

export function ConfigEditorLayout({ title, icon, saveStatus = "saved", children, actions }: ConfigEditorLayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
          <SaveStatusIndicator status={saveStatus} />
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">{children}</div>
      </ScrollArea>
    </div>
  );
}
