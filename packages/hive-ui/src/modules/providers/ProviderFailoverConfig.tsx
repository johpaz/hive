import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useProviders } from "@/hooks/useProviders";
import type { ProviderType } from "@/types";
import { useState } from "react";

// Default failover config
const DEFAULT_FAILOVER: FailoverConfig = {
  primary: "openai",
  fallbacks: [],
  triggerConditions: {
    onError: true,
    onRateLimit: true,
    onTimeout: true,
    maxLatencyMs: 5000,
  },
  recoveryStrategy: {
    retryPrimaryAfter: 60,
    circuitBreaker: true,
  },
};

interface FailoverConfig {
  primary: ProviderType;
  fallbacks: ProviderType[];
  triggerConditions: {
    onError: boolean;
    onRateLimit: boolean;
    onTimeout: boolean;
    maxLatencyMs?: number;
  };
  recoveryStrategy: {
    retryPrimaryAfter: number;
    circuitBreaker: boolean;
  };
}

export function ProviderFailoverConfig() {
  const { activeProviders } = useProviders();
  const [failoverConfig, setFailoverConfig] = useState<FailoverConfig>(DEFAULT_FAILOVER);

  const updateConfig = (key: keyof FailoverConfig, value: any) => {
    setFailoverConfig({ ...failoverConfig, [key]: value });
  };

  const updateTrigger = (key: keyof FailoverConfig["triggerConditions"], value: any) => {
    updateConfig("triggerConditions", { ...failoverConfig.triggerConditions, [key]: value });
  };

  const updateRecovery = (key: keyof FailoverConfig["recoveryStrategy"], value: any) => {
    updateConfig("recoveryStrategy", { ...failoverConfig.recoveryStrategy, [key]: value });
  };

  return (
    <div className="hive-card">
      <div className="p-4 border-b border-white/5">
        <h3 className="hive-title-section">Configuración de Failover</h3>
      </div>
      <div className="hive-card-body space-y-4">
        <div className="space-y-1">
          <Label className="hive-label">Provider Primario</Label>
          <Select
            value={failoverConfig.primary}
            onValueChange={(val) => updateConfig("primary", val as ProviderType)}
          >
            <SelectTrigger className="hive-select-trigger !h-8 text-sm"><SelectValue placeholder="Selecciona un provider primario" /></SelectTrigger>
            <SelectContent className="hive-select-content">
              {activeProviders.length === 0 && <SelectItem value="none" disabled className="hive-select-item">No hay providers activos</SelectItem>}
              {activeProviders.map((p) => (
                <SelectItem key={p.id} value={p.type} className="hive-select-item">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="hive-label">Condiciones de activación</Label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Al error de conexión</span>
              <Switch checked={failoverConfig.triggerConditions.onError} onCheckedChange={(val) => updateTrigger("onError", val)} className="data-[state=checked]:bg-blue-500" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Al rate limit</span>
              <Switch checked={failoverConfig.triggerConditions.onRateLimit} onCheckedChange={(val) => updateTrigger("onRateLimit", val)} className="data-[state=checked]:bg-blue-500" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Al timeout</span>
              <Switch checked={failoverConfig.triggerConditions.onTimeout} onCheckedChange={(val) => updateTrigger("onTimeout", val)} className="data-[state=checked]:bg-blue-500" />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="hive-label">Latencia máxima (ms)</Label>
          <Input
            type="number"
            value={failoverConfig.triggerConditions.maxLatencyMs}
            onChange={(e) => updateTrigger("maxLatencyMs", Number(e.target.value))}
            className="hive-input !h-8 text-sm"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Circuit Breaker</span>
          <Switch checked={failoverConfig.recoveryStrategy.circuitBreaker} onCheckedChange={(val) => updateRecovery("circuitBreaker", val)} className="data-[state=checked]:bg-blue-500" />
        </div>
      </div>
    </div>
  );
}
