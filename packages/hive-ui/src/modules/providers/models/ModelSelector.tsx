import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProviders } from "@/hooks/useProviders";
import type { Model } from "@/types";

interface ModelSelectorProps {
  value?: string;
  onSelect?: (modelId: string) => void;
  providerFilter?: string;
}

export function ModelSelector({ value, onSelect, providerFilter }: ModelSelectorProps) {
  const { availableModels } = useProviders();
  const models = providerFilter ? availableModels.filter((m) => m.providerId === providerFilter) : availableModels;

  return (
    <Select value={value} onValueChange={onSelect}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Seleccionar modelo..." />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <span className="flex items-center gap-2">
              <span>{model.name}</span>
              <span className="text-muted-foreground">({model.providerId})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
