import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Wrench, Loader2 } from "lucide-react";
import { useTools } from "@/hooks/useProviders";
import { Toast } from "@/lib/swal";

export function ToolRegistry() {
  const { tools, activeTools, isLoading, fetchTools, toggleTool } = useTools();
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleToggle = async (id: string, active: boolean) => {
    if (togglingSkill) return;
    setTogglingSkill(id);
    try {
      await toggleTool(id, active);
      Toast.fire({ icon: "success", title: `Tool ${active ? "activada" : "desactivada"}` });
    } catch (error) {
      Toast.fire({ icon: "error", title: "Error al cambiar estado de la tool" });
    } finally {
      setTogglingSkill(null);
    }
  };

  const sourceColors: Record<string, "default" | "secondary" | "outline"> = {
    bundled: "secondary",
    managed: "default",
    workspace: "outline",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Cargando tools...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Tools del agente</h4>
        <Badge variant="secondary" className="text-xs">{activeTools.length} activas</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {tools.map((tool) => (
          <Card key={tool.id} className={tool.active ? "border-primary/30" : "opacity-70"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    {tool.name}
                    <Badge variant={sourceColors[tool.category || "bundled"]} className="text-[10px] h-4">
                      {tool.category || "bundled"}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                </div>
                <Switch
                  checked={tool.active}
                  onCheckedChange={(checked) => handleToggle(tool.id, checked)}
                  disabled={togglingSkill === tool.id}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </CardHeader>
          </Card>
        ))}
        {tools.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No hay tools configuradas en la base de datos.
          </div>
        )}
      </div>
    </div>
  );
}
