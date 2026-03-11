import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProviders } from "@/hooks/useProviders";
import type { Model } from "@/types";

interface ModelSelectorProps {
  selectedProviderId?: string;
  selectedModelId?: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selectedProviderId,
  selectedModelId,
  onProviderChange,
  onModelChange,
  disabled = false,
}: ModelSelectorProps) {
  const { activeProviders, getModelsByProvider } = useProviders();
  const availableModels = useMemo(() => {
    if (!selectedProviderId) return [];
    return getModelsByProvider(selectedProviderId);
  }, [selectedProviderId, getModelsByProvider]);

  useEffect(() => {
    if (selectedModelId && availableModels.length > 0 && !availableModels.find((m) => m.id === selectedModelId)) {
      onModelChange("");
    }
  }, [availableModels, selectedModelId, onModelChange]);

  const parseCapabilities = (capabilities?: string | null): string[] => {
    if (!capabilities) return [];
    try {
      return JSON.parse(capabilities);
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-4">
      {/* Provider Selection */}
      <div className="space-y-2">
        <Label htmlFor="provider">Proveedor de IA</Label>
        <Select
          value={selectedProviderId || ""}
          onValueChange={onProviderChange}
          disabled={disabled || activeProviders.length === 0}
        >
          <SelectTrigger id="provider" className="w-full">
            <SelectValue placeholder="Selecciona un proveedor" />
          </SelectTrigger>
          <SelectContent>
            {activeProviders.length === 0 ? (
              <SelectItem value="none" disabled>
                No hay proveedores configurados
              </SelectItem>
            ) : (
              activeProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {activeProviders.length === 0 && (
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
            onValueChange={onModelChange}
            disabled={disabled || availableModels.length === 0}
          >
            <SelectTrigger id="model" className="w-full">
              <SelectValue placeholder="Selecciona un modelo" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.length === 0 ? (
                <SelectItem value="none" disabled>
                  No hay modelos disponibles
                </SelectItem>
              ) : (
                availableModels.map((model) => (
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

          {/* Model Info Card */}
          {selectedModelId && availableModels.find((m) => m.id === selectedModelId) && (
            <Card className="mt-2">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {availableModels.find((m) => m.id === selectedModelId)?.name}
                  </span>
                  <Badge variant="outline">
                    {activeProviders.find((p) => p.id === selectedProviderId)?.name}
                  </Badge>
                </div>
                {(() => {
                  const model = availableModels.find((m) => m.id === selectedModelId);
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
