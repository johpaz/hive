import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProviders } from "@/hooks/useProviders";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelCard } from "@/modules/providers/models/ModelCard";
import { Search, Eye } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";

function parseCapabilities(caps: string | null | undefined): string[] {
  if (!caps) return [];
  if (typeof caps === "string") {
    try { return JSON.parse(caps); } catch { return []; }
  }
  return Array.isArray(caps) ? caps : [];
}

export function VisionModelsTab() {
  const { availableModels, activeProviders } = useProviders();
  const fetchAll = useGlobalConfigStore((s) => s.fetchAll);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");

  // Force fresh data from the DB every time this tab is opened
  useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  const filtered = useMemo(() => {
    return availableModels.filter((m) => {
      const caps = parseCapabilities(m.capabilities);
      const isVisionModel = caps.includes("vision") || caps.includes("image_generation") || caps.includes("ocr");
      const matchesSearch = m.name.toLowerCase().includes(filter.toLowerCase()) || m.id.toLowerCase().includes(filter.toLowerCase());
      const matchesProvider = providerFilter === "all" || m.providerId === providerFilter || m.provider_id === providerFilter;
      return isVisionModel && matchesSearch && matchesProvider;
    });
  }, [availableModels, filter, providerFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Modelos de Imagen / Vision</h3>
        </div>
        <Badge variant="secondary">{filtered.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Estos modelos pueden procesar imagenes y documentos visuales. Si el agente usa uno de estos modelos, las imagenes se envian directamente. Si no, se usa OCR para extraer el texto.
      </p>
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
      <ScrollArea className="h-[calc(100vh-26rem)]">
        <div className="space-y-2">
          {filtered.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
          {filtered.length === 0 && (
            <div className="hive-empty-state">
              <Eye className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p>No hay modelos con capacidad de vision.</p>
              <p className="text-xs mt-1">Habilita modelos con capability "vision" en la tab Providers.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
