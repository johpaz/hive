import { useEffect, useMemo, useRef, useCallback } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProviders } from "@/hooks/useProviders";
import { useGlobalConfigStore } from "@/stores/useGlobalConfigStore";
import { loader } from "@/stores/useLoaderStore";
import { toast } from "@/components/ui/sonner";

interface ModelSelectorProps {
  selectedProviderId?: string;
  selectedModelId?: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  typeFilter?: string;
}

const HIVEAGENTS_POLL_INTERVAL_MS = 2500;
const HIVEAGENTS_LOAD_TIMEOUT_MS = 300000;
const HIVEAGENTS_LOAD_CTX = 50000;

export function ModelSelector({
  selectedProviderId,
  selectedModelId,
  onProviderChange,
  onModelChange,
  disabled = false,
  typeFilter,
}: ModelSelectorProps) {
  const { providers, models } = useProviders();
  const loadHiveAgentsModel = useGlobalConfigStore((state) => state.loadHiveAgentsModel);
  const getHiveAgentsModelStatus = useGlobalConfigStore((state) => state.getHiveAgentsModelStatus);

  const hiveagentsAbortRef = useRef<{ abort: boolean } | null>(null);

  const hasApiKey = (p: typeof providers[number]) => {
    if (p.id === "ollama" || p.id === "hiveagents") return true;
    const baseUrl = p.base_url || p.baseUrl || "";
    if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) return true;
    return !!p.has_api_key;
  };

  const isLocalProvider = (p: typeof providers[number]) => {
    if (p.id === "ollama") return true;
    const baseUrl = p.base_url || p.baseUrl || "";
    return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  };

  // Dropdown options: only active providers with API key
  const providerOptions = providers.filter(p => (p.enabled || p.active) && hasApiKey(p));

  // Configured provider (even if inactive) for display in trigger
  const configuredProvider = providers.find(p => p.id === selectedProviderId);
  const isProviderInactive = !!configuredProvider && !providerOptions.some(p => p.id === configuredProvider.id);

  // All models for selected provider (for name lookup)
  const allModelsForProvider = useMemo(() => {
    if (!selectedProviderId) return [];
    return models.filter((m) => {
      const pid = m.provider_id || m.providerId;
      const matchesProvider = pid === selectedProviderId;
      const matchesType = !typeFilter || m.model_type === typeFilter;
      return matchesProvider && matchesType;
    });
  }, [selectedProviderId, models, typeFilter]);

  // Dropdown options: only active models for selected provider
  const modelOptions = useMemo(() => {
    return allModelsForProvider.filter(m => m.enabled || m.active);
  }, [allModelsForProvider]);

  // Configured model (even if inactive) for display in trigger
  const configuredModel = allModelsForProvider.find(m => m.id === selectedModelId);
  const isModelInactive = !!configuredModel && !modelOptions.some(m => m.id === configuredModel.id);

  useEffect(() => {
    if (selectedModelId && allModelsForProvider.length > 0 && !allModelsForProvider.find((m) => m.id === selectedModelId)) {
      onModelChange("");
    }
  }, [allModelsForProvider, selectedModelId, onModelChange]);

  const parseCapabilities = (capabilities?: string | null): string[] => {
    if (!capabilities) return [];
    try {
      return JSON.parse(capabilities);
    } catch {
      return [];
    }
  };

  const waitForHiveAgentsModel = useCallback(async (modelId: string): Promise<boolean> => {
    const abortRef = { abort: false };
    hiveagentsAbortRef.current = abortRef;
    const start = Date.now();

    try {
      await loadHiveAgentsModel(modelId, HIVEAGENTS_LOAD_CTX);
    } catch {
      return false;
    }

    while (!abortRef.abort && Date.now() - start < HIVEAGENTS_LOAD_TIMEOUT_MS) {
      try {
        const status = await getHiveAgentsModelStatus();
        if (status.loaded && status.model?.name === modelId) {
          return true;
        }
      } catch {
        // ignore polling errors
      }
      await new Promise((resolve) => setTimeout(resolve, HIVEAGENTS_POLL_INTERVAL_MS));
    }

    return false;
  }, [loadHiveAgentsModel, getHiveAgentsModelStatus]);

  const handleModelChange = async (modelId: string) => {
    if (selectedProviderId === "hiveagents" && modelId) {
      loader.show("Cargando modelo en HiveAgents…");
      const loaded = await waitForHiveAgentsModel(modelId);
      loader.hide();
      if (!loaded) {
        toast.error("No se pudo confirmar la carga del modelo", {
          description: "Intenta seleccionar el modelo nuevamente o verifica la conexión.",
        });
        return;
      }
      toast.success("Modelo listo", {
        description: "El modelo de HiveAgents ya está cargado y listo para usar.",
      });
    }

    onModelChange(modelId);
  };

  // Cancel any in-flight hiveagents polling when provider/model changes
  useEffect(() => {
    return () => {
      if (hiveagentsAbortRef.current) {
        hiveagentsAbortRef.current.abort = true;
        hiveagentsAbortRef.current = null;
      }
    };
  }, [selectedProviderId, selectedModelId]);

  return (
    <div className="space-y-4">
      {/* Provider Selection */}
      <div className="space-y-2">
        <Label htmlFor="provider">Proveedor de IA</Label>
        <Select
          value={selectedProviderId || ""}
          onValueChange={onProviderChange}
          disabled={disabled || providerOptions.length === 0}
        >
          <SelectTrigger id="provider" className="w-full">
            <SelectValue placeholder="Selecciona un proveedor">
              {selectedProviderId && configuredProvider ? (
                <div className="flex items-center gap-2">
                  <span>{configuredProvider.name}</span>
                  {isProviderInactive && (
                    <span className="text-[10px] text-amber-400/80">(inactivo)</span>
                  )}
                  {isLocalProvider(configuredProvider) ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">LOCAL</span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">API</span>
                  )}
                </div>
              ) : (
                "Selecciona un proveedor"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providerOptions.length === 0 ? (
              <SelectItem value="none" disabled>
                No hay proveedores configurados
              </SelectItem>
            ) : (
              providerOptions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  <div className="flex items-center gap-2">
                    <span>{provider.name}</span>
                    {isLocalProvider(provider) ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">LOCAL</span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">API</span>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {isProviderInactive && configuredProvider && (
          <p className="text-[10px] text-amber-400/80">
            El proveedor "{configuredProvider.name}" está inactivo. Selecciona uno activo para cambiar.
          </p>
        )}
        {providerOptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Configura un proveedor en{" "}
            <a href="/providers" className="text-primary underline">
              Settings &gt; Providers
            </a>
          </p>
        )}
      </div>

      {/* Model Selection */}
      {selectedProviderId && (
        <div className="space-y-2">
          <Label htmlFor="model">Modelo</Label>
          <Select
            value={selectedModelId || ""}
            onValueChange={handleModelChange}
            disabled={disabled || modelOptions.length === 0}
          >
            <SelectTrigger id="model" className="w-full">
              <SelectValue placeholder="Selecciona un modelo">
                {selectedModelId && configuredModel ? (
                  <div className="flex items-center gap-2">
                    <span>{configuredModel.name}</span>
                    {isModelInactive && (
                      <span className="text-[10px] text-amber-400/80">(inactivo)</span>
                    )}
                  </div>
                ) : (
                  "Selecciona un modelo"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modelOptions.length === 0 ? (
                <SelectItem value="none" disabled>
                  No hay modelos disponibles
                </SelectItem>
              ) : (
                modelOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <span>{model.name}</span>
                      {model.contextWindow && (
                        <Badge variant="secondary" className="text-[10px]">
                          {(model.contextWindow / 1000).toFixed(0)}K ctx
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {isModelInactive && configuredModel && (
            <p className="text-[10px] text-amber-400/80">
              El modelo "{configuredModel.name}" está inactivo. Selecciona uno activo para cambiar.
            </p>
          )}

          {/* Model Info Card */}
          {selectedModelId && allModelsForProvider.find((m) => m.id === selectedModelId) && (
            <Card className="mt-2">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {allModelsForProvider.find((m) => m.id === selectedModelId)?.name}
                  </span>
                  <Badge variant="outline">
                    {providers.find((p) => p.id === selectedProviderId)?.name}
                  </Badge>
                </div>
                {(() => {
                  const model = allModelsForProvider.find((m) => m.id === selectedModelId);
                  const capabilities = parseCapabilities(model?.capabilities);
                  if (capabilities.length > 0) {
                    return (
                      <div className="flex flex-wrap gap-1">
                        {capabilities.slice(0, 5).map((cap) => (
                          <Badge key={cap} variant="secondary" className="text-[10px]">
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
