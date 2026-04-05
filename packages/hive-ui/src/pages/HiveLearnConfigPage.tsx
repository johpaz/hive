import { useEffect, useState } from "react";
import { Settings2, CheckCircle2, AlertCircle, Brain, GitBranch, Zap, Database, ChevronDown } from "lucide-react";

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  active: boolean;
}

interface Model {
  id: string;
  name: string;
  provider_id: string;
  enabled: boolean;
  active: boolean;
  context_window?: number;
}

export function HiveLearnConfigPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [providersRes, modelsRes, configRes, agentsRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/models"),
          fetch("/api/hivelearn/config"),
          fetch("/api/hivelearn/agents"),
        ]);
        const { providers: pData } = await providersRes.json();
        const { models: mData } = await modelsRes.json();
        const config = await configRes.json();
        const agentsData = await agentsRes.json();

        const activeProviders = (pData ?? []).filter((p: Provider) => p.enabled && p.active);
        const activeModels = (mData ?? []).filter((m: Model) => m.enabled && m.active);

        setProviders(activeProviders);
        setModels(activeModels);
        setAgentCount((agentsData.agents ?? []).length);

        if (config.configured && config.providerId) {
          setSelectedProviderId(config.providerId);
          setSelectedModelId(config.modelId);
        }
      } catch {
        // silently fail — user will see empty selectors
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const availableModels = models.filter(m => m.provider_id === selectedProviderId);

  const handleSave = async () => {
    if (!selectedProviderId || !selectedModelId) return;
    setIsSaving(true);
    setSaveStatus("idle");
    setSaveError(null);
    try {
      const res = await fetch("/api/hivelearn/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: selectedProviderId, modelId: selectedModelId }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
        setSaveError(data.error ?? "Error al guardar");
      }
    } catch {
      setSaveStatus("error");
      setSaveError("Error de conexión");
    } finally {
      setIsSaving(false);
    }
  };

  const selectedProviderName = providers.find(p => p.id === selectedProviderId)?.name;
  const selectedModelName = models.find(m => m.id === selectedModelId)?.name;

  return (
    <div className="hive-page mt-10 animate-in fade-in duration-700">
      <div className="hive-page-container max-w-2xl">
        {/* Header */}
        <div className="hive-page-header mb-8 animate-in slide-in-from-left-8 duration-700">
          <div className="hive-page-header__eyebrow mb-3 opacity-80">
            <div className="hive-page-header__dot animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.6)]" />
            <span className="hive-page-header__label tracking-widest font-semibold text-amber-400">HIVELEARN</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white drop-shadow-lg mb-4">
            Configuración <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">del Enjambre</span>
          </h2>
          <p className="text-white/60 text-sm leading-relaxed font-light">
            Selecciona el proveedor y modelo que usarán los {agentCount || 15} agentes educativos.
            Esta configuración se aplica a todo el enjambre.
          </p>
        </div>

        {/* Ambient glow */}
        <div className="absolute -top-40 -left-40 h-[400px] w-[400px] bg-amber-600/10 rounded-full blur-[120px] pointer-events-none opacity-50" />

        {isLoading ? (
          <div className="h-48 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
        ) : (
          <div className="relative z-10 space-y-6">
            {/* Provider selection */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/20">
                  <Brain className="h-4 w-4 text-amber-400" />
                </div>
                <h3 className="font-bold text-white">Modelo de IA</h3>
              </div>

              {/* Provider */}
              <div>
                <label className="block text-xs text-white/40 mb-3 uppercase tracking-wider font-semibold">
                  Proveedor
                </label>
                {providers.length === 0 ? (
                  <p className="text-sm text-white/30 italic">
                    No hay proveedores activos. Configura uno en{" "}
                    <a href="/providers" className="text-amber-400 hover:underline">Providers</a>.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {providers.map(provider => (
                      <button
                        key={provider.id}
                        onClick={() => {
                          setSelectedProviderId(provider.id);
                          setSelectedModelId(null);
                          setSaveStatus("idle");
                        }}
                        className={`rounded-xl py-3 px-4 text-sm font-medium border transition-all text-left
                          ${selectedProviderId === provider.id
                            ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                            : "bg-white/[0.02] border-white/10 text-white/50 hover:border-amber-500/40 hover:text-white/80"}`}
                      >
                        <div className="font-bold">{provider.name}</div>
                        <div className="text-[10px] text-current opacity-50 mt-0.5 font-mono">{provider.id}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Model */}
              {selectedProviderId && (
                <div>
                  <label className="block text-xs text-white/40 mb-3 uppercase tracking-wider font-semibold">
                    Modelo
                  </label>
                  {availableModels.length === 0 ? (
                    <p className="text-sm text-white/30 italic">No hay modelos disponibles para este proveedor.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {availableModels.map(model => (
                        <button
                          key={model.id}
                          onClick={() => { setSelectedModelId(model.id); setSaveStatus("idle"); }}
                          className={`rounded-xl py-3 px-4 text-sm font-medium border transition-all text-left
                            ${selectedModelId === model.id
                              ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                              : "bg-white/[0.02] border-white/10 text-white/50 hover:border-amber-500/40 hover:text-white/80"}`}
                        >
                          <div className="font-bold">{model.name}</div>
                          {model.context_window && (
                            <div className="text-[10px] text-current opacity-50 mt-0.5">
                              {(model.context_window / 1000).toFixed(0)}K tokens
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Summary */}
              {selectedProviderId && selectedModelId && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="text-[10px] text-amber-400/70 uppercase tracking-wider mb-1 font-semibold">
                    Configuración seleccionada
                  </div>
                  <div className="text-sm text-white">
                    <span className="font-bold text-amber-300">{selectedProviderName}</span>
                    <span className="text-white/30 mx-2">→</span>
                    <span className="font-bold text-amber-300">{selectedModelName}</span>
                  </div>
                  <div className="text-[11px] text-white/30 mt-1">
                    Se aplicará a los {agentCount || 15} agentes del enjambre
                  </div>
                </div>
              )}

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={!selectedProviderId || !selectedModelId || isSaving}
                className="w-full py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Settings2 className="h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Settings2 className="h-4 w-4" />
                    Guardar configuración
                  </>
                )}
              </button>

              {/* Feedback */}
              {saveStatus === "success" && (
                <div className="flex items-center gap-2 text-green-400 text-sm animate-in fade-in duration-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Configuración guardada — los {agentCount || 15} agentes ahora usan {selectedProviderName} / {selectedModelName}
                </div>
              )}
              {saveStatus === "error" && (
                <div className="flex items-center gap-2 text-red-400 text-sm animate-in fade-in duration-300">
                  <AlertCircle className="h-4 w-4" />
                  {saveError}
                </div>
              )}
            </div>

            {/* ── Mini pipeline preview ── */}
            <MiniSwarmPreview agentCount={agentCount || 16} />

            {/* ── Insight cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ConfigInsightCard
                icon={GitBranch}
                title="DAG Scheduler"
                description="Orquesta los agentes en orden óptimo con grafo de dependencias."
                colorClass="bg-amber-500/5 border-amber-500/20"
                iconColor="text-amber-400"
              />
              <ConfigInsightCard
                icon={Zap}
                title="Paralelismo"
                description="8 agentes de contenido trabajan simultáneamente. Hasta 8× más rápido."
                colorClass="bg-blue-500/5 border-blue-500/20"
                iconColor="text-blue-400"
              />
              <ConfigInsightCard
                icon={Database}
                title="Caché Inteligente"
                description="Nodos ya generados se reutilizan. Segunda lección del mismo tema: ~10s."
                colorClass="bg-purple-500/5 border-purple-500/20"
                iconColor="text-purple-400"
              />
            </div>

            {/* ── Timing note ── */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-center">
              <p className="text-[11px] text-white/30 font-mono tracking-wider">
                ⏱ Primera lección: ~2 min &nbsp;·&nbsp; 🐝 Con caché: ~10 seg &nbsp;·&nbsp; {agentCount || 16} agentes activos
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mini pipeline preview (collapsible) ──────────────────────────────────────
const PIPELINE_PHASES = [
  { label: "Análisis", agents: ["👤", "🎯", "🗺️"], color: "text-amber-400", pillColor: "bg-amber-500/10 border-amber-500/20" },
  { label: "Contenido", agents: ["📖", "✏️", "❓", "⚡", "💻", "📊", "🎞️", "🖼️"], color: "text-blue-400", pillColor: "bg-blue-500/10 border-blue-500/20" },
  { label: "Final", agents: ["📈", "🏆", "📝", "🔍", "🧠"], color: "text-green-400", pillColor: "bg-green-500/10 border-green-500/20" },
];

function MiniSwarmPreview({ agentCount }: { agentCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-base">🐝</span>
          <span className="text-sm font-semibold text-white/70">
            Ver cómo trabajan los {agentCount} agentes
          </span>
        </div>
        <ChevronDown className={`h-4 w-4 text-white/30 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="h-px bg-white/5 mb-4" />
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {PIPELINE_PHASES.map((phase, i) => (
              <div key={phase.label} className="flex items-center gap-2 flex-shrink-0">
                <div className="space-y-1.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border ${phase.pillColor} ${phase.color}`}>
                    {phase.label}
                  </span>
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {phase.agents.map(emoji => (
                      <span key={emoji} className="w-7 h-7 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-sm hover:bg-white/10 hover:border-white/10 transition-colors cursor-default">
                        {emoji}
                      </span>
                    ))}
                  </div>
                </div>
                {i < PIPELINE_PHASES.length - 1 && (
                  <div className="flex flex-col items-center gap-0.5 self-end mb-1">
                    <div className="w-6 h-px border-t-2 border-dashed border-amber-500/25" />
                    <span className="text-amber-500/30 text-xs">→</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config insight card ───────────────────────────────────────────────────────
function ConfigInsightCard({ icon: Icon, title, description, colorClass, iconColor }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  colorClass: string;
  iconColor: string;
}) {
  return (
    <div className={`rounded-xl border p-3.5 space-y-2 transition-all duration-200 hover:scale-[1.01] ${colorClass}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        <p className="text-xs font-bold text-white/80">{title}</p>
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed">{description}</p>
    </div>
  );
}
