import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api";

interface MemoryEntry {
  key: string;
  value: string;
  createdAt?: string;
}

export function UserMemoryManager() {
  const { data: memories, isLoading, isError } = useQuery<MemoryEntry[]>({
    queryKey: ["user-memories"],
    queryFn: async () => {
      const config = await apiClient<any>("/api/config");
      const workspace = config.agents?.list?.[0]?.workspace || "~/.hive/workspace";
      return [{ key: "workspace", value: workspace }];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-blue-400" />
          Memorias del usuario
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Cargando...</span>
          </div>
        ) : isError ? (
          <p className="text-xs text-muted-foreground">No se pudieron cargar las memorias</p>
        ) : !memories || memories.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin memorias guardadas</p>
        ) : (
          <div className="space-y-1">
            {memories.map((m) => (
              <div key={m.key} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs">
                <span className="font-medium">{m.key}</span>
                <span className="text-muted-foreground">{m.value}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-2">Las memorias se almacenan en el directorio workspace/memory/</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
