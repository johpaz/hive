import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api";

export function ToolUsageStats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["tool-usage-stats"],
    queryFn: async () => {
      const data = await apiClient<{ skills: any[] }>("/api/skills");
      const skills = data.skills || [];
      const bySource: Record<string, number> = {};
      skills.forEach((s) => {
        bySource[s.source] = (bySource[s.source] || 0) + 1;
      });
      return { totalSkills: skills.length, bySource };
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4" />
          Estadísticas de skills
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Cargando...</span>
          </div>
        ) : stats ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{stats.totalSkills} skills totales</p>
            <div className="flex gap-3">
              {Object.entries(stats.bySource).map(([source, count]) => (
                <div key={source} className="rounded-md border px-3 py-1.5 text-center">
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground">{source}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sin datos de uso disponibles</p>
        )}
      </CardContent>
    </Card>
  );
}
