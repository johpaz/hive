import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

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
  agentId, agentName, agentDescription, open, onOpenChange, onSuccess,
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

  // Load agent data + providers + models
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    Promise.all([
      apiClient<{ agents: AgentData[] }>("/api/agents").catch(() => ({ agents: [] })),
      apiClient<{ providers: Provider[] }>("/api/providers").catch(() => ({ providers: [] })),
      apiClient<{ models: Model[] }>("/api/models").catch(() => ({ models: [] })),
    ]).then(([agentsRes, provRes, modelRes]) => {
      const allAgents = (agentsRes as any)?.agents ?? [];
      const agent = allAgents.find((a: AgentData) => a.id === agentId);
      if (agent) {
        setFormData({
          systemPrompt: agent.system_prompt ?? "",
          providerId: agent.provider_id ?? "",
          modelId: agent.model_id ?? "",
          workspace: agent.workspace ?? "",
          tone: agent.tone ?? "",
          enabled: agent.enabled ?? true,
          maxIterations: agent.max_iterations ?? 3,
        });
      }
      setProviders(provRes.providers ?? []);
      setModels(modelRes.models ?? []);
      setLoading(false);
    });
  }, [open, agentId]);

  const filteredModels = models.filter(m => m.provider_id === formData.providerId && m.enabled && m.active);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient(`/api/agents/${agentId}`, {
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
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#131b2e] border-white/[0.08]">
                    {providers.filter(p => p.enabled && p.active).map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-white hover:bg-white/10">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" /> Modelo
                </Label>
                <Select value={formData.modelId} onValueChange={v => setFormData(f => ({ ...f, modelId: v }))}>
                  <SelectTrigger className="bg-[#060e20] border-white/[0.08] text-white">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#131b2e] border-white/[0.08]">
                    {filteredModels.map(m => (
                      <SelectItem key={m.id} value={m.id} className="text-white hover:bg-white/10">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
          <DialogClose asChild>
            <Button variant="outline" className="border-white/[0.08] text-white/50 hover:text-white hover:bg-white/5">
              Cancelar
            </Button>
          </DialogClose>
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
