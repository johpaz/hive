import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProviders } from "@/hooks/useProviders";
import { ModelCard } from "./ModelCard";
import { Search } from "lucide-react";
import { useState } from "react";

export function ModelList() {
  const { availableModels, providers } = useProviders();
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");

  const filtered = availableModels.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(filter.toLowerCase()) || m.id.toLowerCase().includes(filter.toLowerCase());
    const matchesProvider = providerFilter === "all" || m.providerId === providerFilter || m.provider_id === providerFilter;
    return matchesSearch && matchesProvider;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Modelos Disponibles</h3>
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
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="h-[calc(100vh-20rem)]">
        <div className="space-y-2">
          {filtered.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
