import { useEffect, useState, useCallback } from "react";
import { Settings2, Brain, GitBranch, Zap, Database, Bot } from "lucide-react";
import {
  ProviderSelector,
  ModelSelector,
  ConfigSummary,
  SwarmPipelinePreview,
  ConfigInsightCard,
  StatusMessage,
} from "@/modules/hivelearn/config";
import type { ProviderOption, ModelOption } from "@/modules/hivelearn/config";

interface HiveLearnConfig {
  configured: boolean;
  providerId: string | null;
  modelId: string | null;
}

interface AgentResponse {
  agents: Array<{ id: string; status: string }>;
}

export function HiveLearnConfigPage() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);

  // Load data from real API
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

        const providersData = await providersRes.json();
        const modelsData = await modelsRes.json();
        const configData: HiveLearnConfig = await configRes.json();
        const agentsData: AgentResponse = await agentsRes.json();

        // Filter to only active/enabled providers (match store logic: OR not AND)
        const activeProviders: ProviderOption[] = (providersData.providers ?? [])
          .filter((p: any) => p.enabled || p.active)
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            active: p.active ?? false,
            hasApiKey: !!p.config?.apiKey || p.isLocal || !!p.api_key,
            isLocal: p.isLocal ?? false,
          }));

        // Filter to only active/enabled models (match store logic: OR not AND)
        const activeModels: ModelOption[] = (modelsData.models ?? [])
          .filter((m: any) => m.enabled || m.active)
          .map((m: any) => ({
            id: m.id,
            name: m.name,
            provider_id: m.provider_id,
            context_window: m.context_window,
            capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
            active: m.active ?? false,
          }));

        setProviders(activeProviders);
        setModels(activeModels);
        setAgentCount((agentsData.agents ?? []).length || 16);

        // Restore saved config if exists
        if (configData.configured && configData.providerId) {
          setSelectedProviderId(configData.providerId);
          setSelectedModelId(configData.modelId);
        }
      } catch {
        // Silently fail — user will see empty selectors
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const availableModels = models.filter(m => m.provider_id === selectedProviderId);

  const handleSave = useCallback(async () => {
    if (!selectedProviderId || !selectedModelId) return;
    setIsSaving(true);
    setSaveStatus("loading");
    setSaveError(null);
    try {
      const res = await fetch("/api/hivelearn/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: selectedProviderId, modelId: selectedModelId }),
      });
      const data = await res.json();
      if (data.ok || data.configured) {
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
  }, [selectedProviderId, selectedModelId]);

  const selectedProviderName = providers.find(p => p.id === selectedProviderId)?.name ?? "";
  const selectedModelName = models.find(m => m.id === selectedModelId)?.name ?? "";

  return (
    <div className="hive-page">
      {/* Ambient mesh gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 h-[600px] w-[600px] rounded-full blur-[150px]" style={{ background: "hsl(var(--hive-blue) / 0.05)" }} />
        <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full blur-[150px]" style={{ background: "hsl(var(--hive-blue-dark) / 0.05)" }} />
      </div>

      <div className="hive-page-container">
        {/* Header Section */}
        <div className="mb-12 animate-in slide-in-from-left-8 duration-700">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{
                    background: "hsl(var(--hive-blue))",
                    boxShadow: "0 0 10px hsl(var(--hive-blue) / 0.6)",
                  }}
                />
                <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "hsl(var(--hive-blue))" }}>
                  HIVELEARN
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4" style={{ letterSpacing: "-0.02em", color: "hsl(var(--hive-foreground))" }}>
                Configuración del{" "}
                <span className="italic" style={{ color: "hsl(var(--hive-blue))" }}>
                  Enjambre
                </span>
              </h1>
              <p className="text-sm max-w-lg leading-relaxed font-light" style={{ color: "hsl(var(--hive-muted-foreground))" }}>
                Selecciona el proveedor y modelo que usarán los {agentCount || 16} agentes educativos.
                Esta configuración se aplica a todo el enjambre.
              </p>
            </div>

            <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full border" style={{ background: "hsl(var(--hive-surface) / 0.8)", borderColor: "hsl(0 0% 100% / 0.06)" }}>
              <Bot className="h-4 w-4" style={{ color: "hsl(var(--hive-blue))" }} />
              <span className="text-sm font-semibold">{agentCount || 16} agentes activos</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="h-64 rounded-2xl animate-pulse border" style={{ background: "hsl(var(--hive-surface))", borderColor: "hsl(0 0% 100% / 0.05)" }} />
        ) : (
          <div className="space-y-8">
            {/* Main Configuration Card — Motor de Inteligencia */}
            <div
              className="rounded-2xl border backdrop-blur-xl p-8 space-y-6"
              style={{
                borderColor: "hsl(0 0% 100% / 0.06)",
                background: "hsl(220 15% 11% / 0.8)",
                boxShadow: "0 20px 60px hsl(0 0% 0% / 0.4)",
              }}
            >
              {/* Card Header */}
              <div className="flex items-center gap-4">
                <div
                  className="p-3 rounded-xl border"
                  style={{
                    background: "hsl(var(--hive-blue) / 0.1)",
                    borderColor: "hsl(var(--hive-blue) / 0.2)",
                    boxShadow: "0 0 15px hsl(var(--hive-blue) / 0.1)",
                  }}
                >
                  <Brain className="h-5 w-5" style={{ color: "hsl(var(--hive-blue))" }} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: "hsl(var(--hive-foreground))" }}>
                    Motor de Inteligencia
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: "hsl(var(--hive-muted-foreground) / 0.5)" }}>
                    Configura el cerebro compartido del enjambre
                  </p>
                </div>
              </div>

              {/* Divider via tonal transition */}
              <div className="h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

              {/* Provider Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "hsl(var(--hive-muted-foreground) / 0.6)" }}>
                  Proveedor
                </label>
                <ProviderSelector
                  providers={providers}
                  selectedId={selectedProviderId}
                  onSelect={(id) => {
                    setSelectedProviderId(id);
                    setSelectedModelId(null);
                    setSaveStatus("idle");
                  }}
                />
              </div>

              {/* Model Selection */}
              {selectedProviderId && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "hsl(var(--hive-muted-foreground) / 0.6)" }}>
                    Modelo
                  </label>
                  <ModelSelector
                    models={availableModels}
                    selectedId={selectedModelId}
                    onSelect={(id) => { setSelectedModelId(id); setSaveStatus("idle"); }}
                  />
                </div>
              )}

              {/* Configuration Summary */}
              {selectedProviderId && selectedModelId && selectedProviderName && selectedModelName && (
                <ConfigSummary
                  providerName={selectedProviderName}
                  modelName={selectedModelName}
                  agentCount={agentCount || 16}
                />
              )}

              {/* Save Button */}
              <button
                onClick={handleSave}
                disabled={!selectedProviderId || !selectedModelId || isSaving}
                className="w-full py-3.5 px-6 rounded-xl text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2.5 active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--hive-blue-dark)), hsl(var(--hive-blue)))",
                  boxShadow: "0 0 20px hsl(var(--hive-blue) / 0.25)",
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = "linear-gradient(135deg, hsl(var(--hive-blue-dark) / 0.9), hsl(var(--hive-blue) / 0.9))";
                    e.currentTarget.style.boxShadow = "0 0 30px hsl(var(--hive-blue) / 0.4)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.background = "linear-gradient(135deg, hsl(var(--hive-blue-dark)), hsl(var(--hive-blue)))";
                    e.currentTarget.style.boxShadow = "0 0 20px hsl(var(--hive-blue) / 0.25)";
                  }
                }}
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

              {/* Status Messages */}
              {saveStatus !== "idle" && (
                <StatusMessage
                  type={saveStatus === "loading" ? "loading" : saveStatus === "success" ? "success" : "error"}
                  message={
                    saveStatus === "success"
                      ? `Configuración guardada — los ${agentCount || 16} agentes ahora usan ${selectedProviderName} / ${selectedModelName}`
                      : saveError ?? "Error desconocido"
                  }
                />
              )}
            </div>

            {/* Swarm Pipeline Preview */}
            <SwarmPipelinePreview agentCount={agentCount || 16} />

            {/* Insight Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ConfigInsightCard
                icon={GitBranch}
                title="DAG Scheduler"
                description="Orquesta los agentes en orden óptimo con grafo de dependencias."
                theme="blue"
              />
              <ConfigInsightCard
                icon={Zap}
                title="Paralelismo"
                description="8 agentes de contenido trabajan simultáneamente. Hasta 8× más rápido."
                theme="cyan"
              />
              <ConfigInsightCard
                icon={Database}
                title="Caché Inteligente"
                description="Nodos ya generados se reutilizan. Segunda lección del mismo tema: ~10s."
                theme="purple"
              />
            </div>

            {/* Timing Note */}
            <div
              className="rounded-xl border p-4 text-center backdrop-blur-sm"
              style={{
                background: "hsl(220 15% 11% / 0.6)",
                borderColor: "hsl(0 0% 100% / 0.06)",
              }}
            >
              <p className="text-[11px] font-mono tracking-wider" style={{ color: "hsl(var(--hive-muted-foreground) / 0.35)" }}>
                ⏱ Primera lección: ~2 min &nbsp;·&nbsp; 🐝 Con caché: ~10 seg &nbsp;·&nbsp; {agentCount || 16} agentes activos
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
