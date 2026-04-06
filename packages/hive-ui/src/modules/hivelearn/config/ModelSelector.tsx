import { Cpu, Zap } from "lucide-react";

export interface ModelOption {
  id: string;
  name: string;
  provider_id: string;
  context_window?: number;
  capabilities?: string[];
  active: boolean;
}

interface ModelSelectorProps {
  models: ModelOption[];
  selectedId: string | null;
  onSelect: (modelId: string) => void;
}

export function ModelSelector({ models, selectedId, onSelect }: ModelSelectorProps) {
  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
        <Cpu className="mx-auto mb-3 h-8 w-8 text-white/20" />
        <p className="text-sm text-white/40 italic">
          No hay modelos disponibles para este proveedor.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {models.map(model => {
        const isSelected = selectedId === model.id;
        return (
          <button
            key={model.id}
            onClick={() => onSelect(model.id)}
            className={`relative rounded-xl py-4 px-4 text-sm font-medium border transition-all duration-300 text-left overflow-hidden
              ${isSelected
                ? "border-blue-500/60 text-blue-300 shadow-[0_0_20px_hsl(var(--hive-blue)/0.12)]"
                : "border-white/[0.06] text-white/60 hover:border-blue-500/30 hover:text-white/90"
              }`}
            style={{
              background: isSelected
                ? "hsl(var(--hive-blue) / 0.15)"
                : "hsl(0 0% 100% / 0.02)",
            }}
          >
            {isSelected && (
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
            )}
            <div className="relative z-10">
              <div className="font-bold text-sm mb-1">{model.name}</div>
              {model.context_window && (
                <div className="flex items-center gap-1 text-[9px] font-mono opacity-50 tracking-wider mb-2">
                  <Cpu className="h-2.5 w-2.5" />
                  {(model.context_window / 1000).toFixed(0)}K tokens
                </div>
              )}
              {model.capabilities && Array.isArray(model.capabilities) && model.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {model.capabilities.map((cap: string) => (
                    <span
                      key={cap}
                      className="px-1.5 py-0.5 rounded text-[8px] font-medium uppercase tracking-wider border"
                      style={{
                        background: "hsl(var(--hive-blue) / 0.1)",
                        borderColor: "hsl(var(--hive-blue) / 0.2)",
                        color: "hsl(var(--hive-blue))",
                      }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
