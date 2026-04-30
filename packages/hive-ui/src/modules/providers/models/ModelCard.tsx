import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useModels } from "@/hooks/useProviders";
import type { Model } from "@/types";
import { ModelCapabilities } from "./ModelCapabilities";

interface ModelCardProps {
  model: Model;
}

export function ModelCard({ model }: ModelCardProps) {
  const { toggleModel } = useModels();

  return (
    <Card className={!model.active ? "opacity-70 bg-muted/30" : ""}>
      <CardContent className="flex items-center gap-4 p-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{model.name}</p>
            <Badge variant="secondary" className="text-[10px]">{model.providerId || model.provider_id}</Badge>
          </div>
          {model.contextWindow && (
            <p className="text-xs text-muted-foreground">
              {(model.contextWindow / 1000).toFixed(0)}K tokens contexto
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <ModelCapabilities capabilities={model.capabilities} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Switch
            checked={!!model.active}
            onCheckedChange={(checked) => toggleModel(model.id, checked)}
          />
          <Badge variant={model.active ? "default" : "secondary"} className="text-[10px]">
            {model.active ? "Activo" : "Inactivo"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
