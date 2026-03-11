import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

interface ToolConfigPanelProps {
  toolId: string;
}

export function ToolConfigPanel({ toolId }: ToolConfigPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings className="h-4 w-4" />
          Configurar herramienta
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Parámetros de tool: {toolId}</p>
      </CardContent>
    </Card>
  );
}
