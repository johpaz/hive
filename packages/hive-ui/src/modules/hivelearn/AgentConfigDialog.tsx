import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Sparkles, Cpu } from "lucide-react";
import { apiClient } from "@/lib/api";

interface AgentConfigDialogProps {
  agentId: string;
  agentName: string;
  agentDescription: string;
  agentData: AgentData;  // Required - passed from parent
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  active: boolean;
  has_api_key?: boolean;
  hasApiKey?: boolean;
  isLocal?: boolean;
  base_url?: string;
  baseUrl?: string;
  config?: { apiKey?: string };
  api_key?: string;
}

interface Model {
  id: string;
  name: string;
  provider_id: string;
  enabled: boolean;
  active: boolean;
}

interface AgentData {
  id: string;
  name: string;
  description: string;
  provider_id: string;
  model_id: string;
  system_prompt: string;
  workspace: string;
  tone: string;
  role: string;
  enabled: boolean;
  max_iterations: number;
}

export function AgentConfigDialog({
  agentId, agentName, agentDescription, agentData, open, onOpenChange, onSuccess,
}: AgentConfigDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [formData, setFormData] = useState({
    systemPrompt: "",
    providerId: "",
    modelId: "",
    workspace: "",
    tone: "",
    enabled: true,
    maxIterations: 3,
  });

  // Initialize form data from passed agentData + fetch providers/models
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    // Initialize form from passed data (no fetch needed)
    setFormData({
      systemPrompt: agentData.system_prompt ?? "",
      providerId: agentData.provider_id ?? "",
      modelId: agentData.model_id ?? "",
      workspace: agentData.workspace ?? "",
      tone: agentData.tone ?? "",
      enabled: agentData.enabled ?? true,
      maxIterations: agentData.max_iterations ?? 3,
    });

    // Only fetch providers and models
    Promise.all([
      apiClient<{ providers: Provider[] }>("/api/providers").catch(() => ({ providers: [] })),
      apiClient<{ models: Model[] }>("/api/models").catch(() => ({ models: [] })),
    ]).then(([provRes, modelRes]) => {
      setProviders(provRes.providers ?? []);
      setModels(modelRes.models ?? []);
      setLoading(false);
    });
  }, [open, agentData]);

  const hasApiKey = (p: Provider) => {
    if (p.id === "ollama") return true;
    const baseUrl = p.base_url || p.baseUrl || "";
    if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) return true;
    return !!(p.has_api_key || p.hasApiKey || p.config?.apiKey || p.api_key);
  };

  const isLocalProvider = (p: Provider) => {
    if (p.id === "ollama") return true;
    const baseUrl = p.base_url || p.baseUrl || "";
    return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  };

  // Dropdown options: only active providers with API key
  const providerOptions = providers.filter(p => (p.enabled || p.active) && hasApiKey(p));

  // Dropdown options: only active models for selected provider
  const modelOptions = models.filter(m => {
    const pid = m.provider_id;
    return pid === formData.providerId && (m.enabled || m.active);
  });

  // Configured provider (even if inactive) for display in trigger
  const configuredProvider = providers.find(p => p.id === formData.providerId);
  const isProviderInactive = !!configuredProvider && !providerOptions.some(p => p.id === configuredProvider.id);

  // Configured model (even if inactive) for display in trigger
  const allModelsForProvider = models.filter(m => {
    const pid = m.provider_id;
    return pid === formData.providerId;
  });
  const configuredModel = allModelsForProvider.find(m => m.id === formData.modelId);
  const isModelInactive = !!configuredModel && !modelOptions.some(m => m.id === configuredModel.id);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Los agentes HL se guardan en su propio endpoint (tabla hl_agents, sin FK)
      const saveUrl = agentId.startsWith("hl-")
        ? `/api/hivelearn/agents/${agentId}`
        : `/api/agents/${agentId}`;
      await apiClient(saveUrl, {
        method: "PUT",
        body: {
          systemPrompt: formData.systemPrompt,
          providerId: formData.providerId,
          modelId: formData.modelId,
          workspace: formData.workspace,
          tone: formData.tone,
          enabled: formData.enabled,
          maxIterations: formData.maxIterations,
        },
      });
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save agent config:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-[#131b2e] border-white/[0.08] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-purple-400" />
            Configurar agente
          </DialogTitle>
          <DialogDescription className="text-white/40">
            {agentName} — {agentDescription}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 text-purple-400 animate-spin" />
            <span className="ml-3 text-white/50">Cargando configuración...</span>
          </div>
        ) : (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-2">
            {/* System Prompt */}
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                System Prompt
              </Label>
              <Textarea
                value={formData.systemPrompt}
                onChange={e => setFormData(f => ({ ...f, systemPrompt: e.target.value }))}
                className="bg-[#060e20] border-white/[0.08] text-white text-sm min-h-[120px] resize-y focus:border-purple-500/50"
                placeholder="Instrucciones del sistema para el agente..."
              />
            </div>

            {/* Provider & Model */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" /> Provider
                </Label>
                <Select value={formData.providerId} onValueChange={v => setFormData(f => ({ ...f, providerId: v, modelId: "" }))}>
                  <SelectTrigger className="bg-[#060e20] border-white/[0.08] text-white">
                    <SelectValue placeholder="Seleccionar...">
                      {formData.providerId && configuredProvider ? (
                        <div className="flex items-center gap-2">
                          <span>{configuredProvider.name}</span>
                          {isProviderInactive && (
                            <span className="text-[10px] text-amber-400/80">(inactivo)</span>
                          )}
                        </div>
                      ) : (
                        "Seleccionar..."
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#131b2e] border-white/[0.08]">
                    {providerOptions.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-white hover:bg-white/10">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isProviderInactive && configuredProvider && (
                  <p className="text-[10px] text-amber-400/80">
                    El proveedor "{configuredProvider.name}" está inactivo.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" /> Modelo
                </Label>
                <Select value={formData.modelId} onValueChange={v => setFormData(f => ({ ...f, modelId: v }))}>
                  <SelectTrigger className="bg-[#060e20] border-white/[0.08] text-white">
                    <SelectValue placeholder="Seleccionar...">
                      {formData.modelId && configuredModel ? (
                        <div className="flex items-center gap-2">
                          <span>{configuredModel.name}</span>
                          {isModelInactive && (
                            <span className="text-[10px] text-amber-400/80">(inactivo)</span>
                          )}
                        </div>
                      ) : (
                        "Seleccionar..."
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#131b2e] border-white/[0.08]">
                    {modelOptions.map(m => (
                      <SelectItem key={m.id} value={m.id} className="text-white hover:bg-white/10">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isModelInactive && configuredModel && (
                  <p className="text-[10px] text-amber-400/80">
                    El modelo "{configuredModel.name}" está inactivo.
                  </p>
                )}
              </div>
            </div>

            {/* Tone & Max Iterations */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Tono
                </Label>
                <Select value={formData.tone} onValueChange={v => setFormData(f => ({ ...f, tone: v }))}>
                  <SelectTrigger className="bg-[#060e20] border-white/[0.08] text-white">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#131b2e] border-white/[0.08]">
                    <SelectItem value="amigable" className="text-white">Amigable</SelectItem>
                    <SelectItem value="motivador" className="text-white">Motivador</SelectItem>
                    <SelectItem value="técnico" className="text-white">Técnico</SelectItem>
                    <SelectItem value="neutro" className="text-white">Neutro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Max Iteraciones
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.maxIterations}
                  onChange={e => setFormData(f => ({ ...f, maxIterations: Number(e.target.value) }))}
                  className="bg-[#060e20] border-white/[0.08] text-white"
                />
              </div>
            </div>

            {/* Workspace */}
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                Workspace
              </Label>
              <Input
                value={formData.workspace}
                onChange={e => setFormData(f => ({ ...f, workspace: e.target.value }))}
                className="bg-[#060e20] border-white/[0.08] text-white font-mono text-xs"
                placeholder="/workspaces/hivelearn/..."
              />
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <p className="text-sm font-semibold text-white">Agente habilitado</p>
                <p className="text-[11px] text-white/30">Desactivar excluye al agente del enjambre</p>
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={v => setFormData(f => ({ ...f, enabled: v }))}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-white/[0.08] text-white/50 hover:text-white hover:bg-white/5"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-purple-600 hover:bg-purple-500 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Guardar configuración
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
