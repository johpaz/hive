import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProviders } from "@/hooks/useProviders";
import { ModelCard } from "@/modules/providers/models/ModelCard";
import { Search, Mic } from "lucide-react";
import { KittenTTSCard } from "@/modules/agent-config/voice/KittenTTSCard";

export function VoiceProvidersTab() {
  const { models, providers } = useProviders();
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const activeProviders = useMemo(() => providers.filter(provider => provider.active && provider.enabled), [providers]);
  const activeProviderIds = useMemo(() => new Set(activeProviders.map(provider => provider.id)), [activeProviders]);
  const selectedProvider = activeProviderIds.has(providerFilter) ? providerFilter : "all";

  const voiceModels = useMemo(() => {
    const query = filter.toLowerCase();
    return models.filter((m) => {
      const providerId = m.providerId || m.provider_id;
      const isVoiceType = (m.supports_stt ?? m.model_type === "stt") || m.model_type === "tts";
      const matchesSearch = m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query);
      return isVoiceType && m.active && m.enabled && !m.unlisted && activeProviderIds.has(providerId) &&
        (selectedProvider === "all" || providerId === selectedProvider) && matchesSearch;
    });
  }, [models, filter, selectedProvider, activeProviderIds]);

  return (
    <div className="space-y-6">
      <KittenTTSCard />

      {/* Voice Models section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Modelos de Voz (STT / TTS)</h3>
          <Badge variant="secondary">{voiceModels.length}</Badge>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar modelo..." className="h-8 pl-8 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Select value={selectedProvider} onValueChange={setProviderFilter}>
            <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {activeProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="h-60">
          <div className="space-y-2">
            {voiceModels.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
            {voiceModels.length === 0 && (
              <div className="hive-empty-state">
                <Mic className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p>No hay modelos de voz disponibles.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
