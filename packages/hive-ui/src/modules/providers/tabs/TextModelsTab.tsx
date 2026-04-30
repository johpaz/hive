import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProviders } from "@/hooks/useProviders";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelCard } from "@/modules/providers/models/ModelCard";
import { Search } from "lucide-react";
import { useState, useMemo, useEffect } from "react";

function parseCapabilities(caps: string | null | undefined): string[] {
  if (!caps) return [];
  if (typeof caps === "string") {
    try { return JSON.parse(caps); } catch { return []; }
  }
  return Array.isArray(caps) ? caps : [];
}

export function TextModelsTab() {
  const { availableModels, activeProviders } = useProviders();
  const fetchAll = useGlobalConfigStore((s) => s.fetchAll);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");

  // Force fresh data from the DB every time this tab is opened
  useEffect(() => {
    fetchAll(true);
  }, []);

  const filtered = useMemo(() => {
    return availableModels.filter((m) => {
      const caps = parseCapabilities(m.capabilities);
      const isTextModel = (caps.includes("chat") || !caps.includes("vision")) && m.model_type !== "stt" && m.model_type !== "tts";
      const matchesSearch = m.name.toLowerCase().includes(filter.toLowerCase()) || m.id.toLowerCase().includes(filter.toLowerCase());
      const matchesProvider = providerFilter === "all" || m.providerId === providerFilter || m.provider_id === providerFilter;
      return isTextModel && matchesSearch && matchesProvider;
    });
  }, [availableModels, filter, providerFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Modelos de Texto</h3>
        <Badge variant="secondary">{filtered.length}</Badge>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar modelo..." className="h-8 pl-8 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {activeProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="h-[calc(100vh-22rem)]">
        <div className="space-y-2">
          {filtered.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
          {filtered.length === 0 && (
            <div className="hive-empty-state">No hay modelos de texto disponibles.</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
