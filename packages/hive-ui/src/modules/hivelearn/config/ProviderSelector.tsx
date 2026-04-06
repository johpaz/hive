import { CheckCircle2, AlertCircle, KeyRound } from "lucide-react";

export interface ProviderOption {
  id: string;
  name: string;
  active: boolean;
  hasApiKey: boolean;
  isLocal?: boolean;
}

interface ProviderSelectorProps {
  providers: ProviderOption[];
  selectedId: string | null;
  onSelect: (providerId: string) => void;
}

export function ProviderSelector({ providers, selectedId, onSelect }: ProviderSelectorProps) {
  if (providers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-white/20" />
        <p className="text-sm text-white/40 italic">
          No hay proveedores activos. Configura uno en{" "}
          <a href="/providers" className="text-blue-400 hover:text-blue-300 hover:underline transition-colors">
            Providers
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {providers.map(provider => {
        const isSelected = selectedId === provider.id;
        return (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            className={`relative rounded-xl py-4 px-4 text-sm font-medium border transition-all duration-300 text-left overflow-hidden group
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
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{provider.name}</span>
                <div className={`h-2 w-2 rounded-full ${provider.active ? "bg-green-500" : "bg-red-500/50"}`} />
              </div>
              <div className="text-[9px] font-mono opacity-50 tracking-wider mb-2">{provider.id}</div>
              <div className="flex items-center gap-1.5">
                {provider.hasApiKey ? (
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                    <KeyRound className="h-2.5 w-2.5" />
                    Configurado
                  </span>
                ) : provider.isLocal ? (
                  <span className="flex items-center gap-1 text-[9px] text-blue-400/70">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Local
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[9px] text-white/20">
                    <AlertCircle className="h-2.5 w-2.5" />
                    Sin clave
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
