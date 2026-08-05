import { Switch } from "@/components/ui/switch";
import { Settings, ChevronDown, ChevronRight, Cpu, Plus, KeyRound, Globe, RefreshCw, Pencil, Trash2 } from "lucide-react";
import type { Provider, Model, ModelFormData } from "@/types";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ProviderConfigForm } from "./ProviderConfigForm";
import { useModels, useProviders } from "@/hooks/useProviders";
import { useState, useMemo } from "react";
import { ModelPriceLine } from "./models/ModelPriceLine";
import { ModelFormDialog } from "./models/ModelFormDialog";
import { summarizeProviderPricing } from "@/lib/model-pricing";
import { formatCostUsd, formatTokens, type ProviderUsage } from "@/hooks/useProviderUsage";

const SettingsIcon = Settings as any;
const ChevronDownIcon = ChevronDown as any;
const ChevronRightIcon = ChevronRight as any;
const CpuIcon = Cpu as any;
const PlusIcon = Plus as any;
const KeyRoundIcon = KeyRound as any;
const GlobeIcon = Globe as any;
const RefreshCwIcon = RefreshCw as any;
const PencilIcon = Pencil as any;
const Trash2Icon = Trash2 as any;

interface ProviderCardProps {
  provider: Provider;
  updateProvider: (id: string, data: { apiKey?: string; baseUrl?: string; headers?: Record<string, string>; numCtx?: number | null }) => void;
  onManageModels?: () => void;
  /** Consumo real del provider. `undefined` = todavía sin cargar o sin registros. */
  usage?: ProviderUsage;
  /** Abre la guía, que vive a nivel de página y no repetida por tarjeta. */
  onOpenGuide?: () => void;
}

export function ProviderCard({ provider, updateProvider, onManageModels, usage, onOpenGuide }: ProviderCardProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  // `null` = el diálogo está cerrado; `undefined` como modelo = alta.
  const [modelForm, setModelForm] = useState<{ model?: Model } | null>(null);

  const { models, toggleModel, createModel, syncModels, deleteModel, updateModel } = useModels();
  const { toggleProvider } = useProviders();

  // Merge models from store + models embedded in provider (from API)
  const providerModels = useMemo(() => {
    const storeModels = models.filter((m) => {
      const mProviderId = m.providerId || m.provider_id;
      return mProviderId === provider.id;
    });
    // If store has models use those, otherwise use embedded ones from provider
    return storeModels.length > 0 ? storeModels : (provider.models || []);
  }, [models, provider.id, provider.models]);

  const activeModels = providerModels.filter(m => m.enabled || m.active);
  const pricing = useMemo(() => summarizeProviderPricing(providerModels), [providerModels]);

  const handleSave = (data: { apiKey?: string; baseUrl?: string; headers?: Record<string, string>; numCtx?: number | null }) => {
    updateProvider(provider.id, data);
    setConfigOpen(false);
  };

  const handleProviderToggle = async (active: boolean) => {
    try {
      await toggleProvider(provider.id, active);
    } catch (error) {
      console.error("Failed to toggle provider:", error);
    }
  };

  const handleModelToggle = async (model: Model, active: boolean) => {
    try {
      await toggleModel(model.id, active);
    } catch (error) {
      console.error("Failed to toggle model:", error);
    }
  };

  const handleSyncModels = async () => {
    setSyncing(true);
    try {
      await syncModels(provider.id);
      setModelsExpanded(true);
    } catch (error) {
      console.error("Failed to sync models:", error);
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmitModel = async (data: ModelFormData) => {
    if (modelForm?.model) {
      await updateModel(modelForm.model.id, data);
    } else {
      await createModel(provider.id, data);
    }
  };

  const handleDeleteModel = async (model: Model) => {
    setDeletingModelId(model.id);
    try {
      await deleteModel(model.id);
    } catch (error) {
      console.error("Failed to delete model:", error);
    } finally {
      setDeletingModelId(null);
    }
  };

  const isActive = !!provider.active;
  const baseUrl = provider.base_url || provider.baseUrl;
  const isLocal = provider.id === "ollama"
    || baseUrl?.includes("localhost")
    || baseUrl?.includes("127.0.0.1");

  return (
    <div className={`hive-card group overflow-hidden flex flex-col gap-0 transition-all duration-500 ${
      isActive ? 'hive-card--active' : 'opacity-70 grayscale-[0.5] hover:grayscale-0 hover:opacity-100'
    }`}>

      {/* ── Header ── */}
      <div className="hive-card-body pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center border transition-all duration-500 ${
              isActive
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_16px_rgba(59,130,246,0.15)]'
                : 'bg-white/5 border-white/10 text-white/30'
            }`}>
              <CpuIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-black text-white tracking-tight text-base sm:text-lg uppercase leading-none truncate">
                  {provider.name}
                </h3>
                {isActive && <div className="hive-status-dot--active h-1.5 w-1.5 shrink-0" />}
              </div>
              <p className="text-[11px] text-white/35 font-medium leading-none truncate">
                {provider.id}
              </p>
            </div>
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <span className={`hidden sm:block text-[10px] font-black tracking-widest ${isActive ? 'text-blue-400' : 'text-white/30'}`}>
              {isActive ? 'ON' : 'OFF'}
            </span>
            <Switch
              checked={isActive}
              onCheckedChange={handleProviderToggle}
              className="data-[state=checked]:bg-blue-500"
            />
          </div>
        </div>
      </div>

      {/* ── Info rows ── */}
      <div className="px-5 pb-3 space-y-2 border-b border-white/5">
        {/* API Key row */}
        <div className="flex items-center gap-2 min-w-0">
          <KeyRoundIcon className={`h-3.5 w-3.5 shrink-0 ${provider.has_api_key ? 'text-emerald-400' : isLocal ? 'text-amber-400' : 'text-white/20'}`} />
          <span className="text-[11px] font-mono truncate">
            {provider.masked_api_key
              ? <span className="text-white/50">{provider.masked_api_key}</span>
              : provider.has_api_key
                ? <span className="text-white/50">••••••••••••••••</span>
                : isLocal
                  ? <span className="text-amber-400/70">Local — sin API key</span>
                  : <span className="text-white/25">Sin API key</span>
            }
          </span>
        </div>

        {/* Base URL row */}
        {baseUrl && (
          <div className="flex items-center gap-2 min-w-0">
            <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-white/20" />
            <span className="text-[11px] text-white/40 truncate font-mono">{baseUrl}</span>
          </div>
        )}

        {/* num_ctx row — solo providers locales */}
        {isLocal && (
          <div className="flex items-center gap-2 min-w-0">
            <CpuIcon className="h-3.5 w-3.5 shrink-0 text-white/20" />
            <span className="text-[11px] text-white/40 font-mono">
              ctx: <span className={provider.num_ctx ? "text-amber-400/70" : "text-white/25"}>
                {provider.num_ctx ? `${provider.num_ctx.toLocaleString()} tokens` : "32 768 (default)"}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* ── Models section ── */}
      <div className="px-5 py-3 flex-1">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            className="flex items-center gap-2 flex-1 text-left text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors"
            onClick={() => setModelsExpanded(!modelsExpanded)}
          >
            {modelsExpanded ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
            MODELOS
            <span className="hive-tag scale-90 origin-left">
              {activeModels.length}/{providerModels.length}
            </span>
          </button>

          {/* Precio de referencia del provider — el modelo más barato por token de entrada */}
          {pricing && (
            <span
              className={`text-[9px] font-mono font-semibold rounded px-1.5 py-0.5 leading-none whitespace-nowrap border ${
                pricing.allFree
                  ? 'text-emerald-400/80 bg-emerald-400/10 border-emerald-400/20'
                  : 'text-white/45 bg-white/5 border-white/10'
              }`}
              title={pricing.allFree
                ? "Todos los modelos de este provider son gratuitos"
                : "Precio del modelo más barato, en USD por millón de tokens de entrada"}
            >
              {pricing.label}
            </span>
          )}

          {/* Badge + botón sync — solo providers locales */}
          {isLocal && (
            <>
              <span className="text-[9px] font-semibold text-amber-400/70 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5 leading-none whitespace-nowrap">
                Actualiza modelos locales
              </span>
              <button
                type="button"
                onClick={handleSyncModels}
                disabled={syncing}
                title="Sincronizar modelos instalados en Ollama"
                className="h-6 w-6 flex items-center justify-center rounded-md text-white/30 hover:text-amber-400 hover:bg-amber-400/10 disabled:opacity-40 transition-colors"
              >
                <RefreshCwIcon className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>

        {/* Collapsed preview — up to 3 chips */}
        {!modelsExpanded && providerModels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {providerModels.slice(0, 3).map(m => (
              <span key={m.id} className={`hive-tag text-[10px] ${m.enabled || m.active ? '' : 'opacity-40'}`}>
                {m.name.split('/').pop() || m.name}
              </span>
            ))}
            {providerModels.length > 3 && (
              <span className="hive-tag text-[10px] text-white/30">+{providerModels.length - 3}</span>
            )}
          </div>
        )}

        {/* Expanded list + add model */}
        {modelsExpanded && (
          <div className="space-y-1">
            <div className="hive-scroll max-h-44 overflow-y-auto flex flex-col gap-0.5 pr-1">
              {providerModels.length === 0 && (
                <p className="text-[11px] text-white/25 py-2 text-center">Sin modelos configurados</p>
              )}
              {providerModels.map((model) => {
                const modelActive = model.enabled || !!model.active;
                return (
                  <div
                    key={model.id}
                    className={`rounded-lg transition-colors ${modelActive ? 'bg-white/5' : 'bg-transparent opacity-40'}`}
                  >
                    <div className="flex items-center justify-between px-2.5 py-1.5">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="block text-[11px] font-medium text-white truncate">
                          {model.name}
                        </span>
                        <ModelPriceLine model={model} showContext />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setModelForm({ model })}
                          title="Editar modelo — ID, contexto, costo y capacidades"
                          className="h-5 w-5 flex items-center justify-center rounded text-white/25 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteModel(model)}
                          disabled={deletingModelId === model.id}
                          title="Eliminar modelo"
                          className="h-5 w-5 flex items-center justify-center rounded text-white/25 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2Icon className="h-3 w-3" />
                        </button>
                        <Switch
                          checked={modelActive}
                          onCheckedChange={(checked) => handleModelToggle(model, checked)}
                          className="scale-[0.7] origin-right data-[state=checked]:bg-blue-400 ml-0.5"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setModelForm({})}
              className="w-full mt-1.5 h-7 flex items-center justify-center gap-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-wider hover:bg-blue-500/20 transition-colors"
            >
              <PlusIcon className="h-3 w-3" />
              Agregar modelo
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between gap-2 overflow-hidden">
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          {/* Consumo real de la BD (usageRollups). "—" cuando no hay registros:
              nunca un número de relleno. */}
          <div className="hive-stat shrink-0" title="Gasto acumulado en los últimos 30 días">
            <span className="hive-stat__label">Gasto 30d</span>
            <span className={`hive-stat__value ${usage && usage.costUsd > 0 ? 'text-amber-400' : 'text-white/30'}`}>
              {usage ? formatCostUsd(usage.costUsd) : '—'}
            </span>
          </div>
          <div className="hive-stat shrink-0" title="Tokens consumidos en los últimos 30 días">
            <span className="hive-stat__label">Tokens</span>
            <span className={`hive-stat__value ${usage && usage.tokens > 0 ? 'text-white/60' : 'text-white/30'}`}>
              {usage ? formatTokens(usage.tokens) : '—'}
            </span>
          </div>
          <div className="hive-stat shrink-0">
            <span className="hive-stat__label">Estado</span>
            <span className={`hive-stat__value ${isActive ? 'text-emerald-400' : 'text-white/30'}`}>
              {isActive ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        </div>

        <Dialog open={configOpen} onOpenChange={setConfigOpen}>
          <DialogTrigger asChild>
            <button className="hive-btn hive-btn--ghost h-8 px-2.5 text-[10px] font-black uppercase tracking-widest text-blue-400 shrink-0 flex items-center gap-1.5">
              <SettingsIcon className="h-3 w-3" />
              <span>CONFIG</span>
            </button>
          </DialogTrigger>
          <DialogContent className="rounded-xl border border-white/10 p-0 overflow-hidden w-[calc(100vw-2rem)] max-w-md bg-[#09090b]">
            <div className="p-5 border-b border-white/5 bg-white/5 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 h-32 w-32 bg-blue-600/10 rounded-full blur-[80px] pointer-events-none" />
              <DialogTitle className="text-lg font-black text-white uppercase tracking-tighter">{provider.name}</DialogTitle>
              <DialogDescription className="text-xs text-white/40 font-medium mt-0.5">Autenticación y punto de enlace.</DialogDescription>
            </div>
            <div className="p-5">
              <ProviderConfigForm
                provider={provider}
                onSave={handleSave}
                onCancel={() => setConfigOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ModelFormDialog
        open={modelForm !== null}
        onOpenChange={(open) => { if (!open) setModelForm(null); }}
        providerId={provider.id}
        model={modelForm?.model}
        onSubmit={handleSubmitModel}
        onOpenGuide={onOpenGuide}
        isFreeProvider={pricing?.allFree ?? false}
      />

      <div className={`hive-strip--bottom ${!isActive ? 'opacity-20' : ''}`} />
    </div>
  );
}
