import { useState, useEffect } from "react";
import { swal } from "@/lib/swal";
import { apiClient } from "@/lib/api";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { ModelSelector } from "./ModelSelector";
import { useAgents, useProviders } from "@/stores/useGlobalConfigStore";
import { Loader2, Sparkles, Shield, Cpu, Save, X, FolderOpen, Check, AlertCircle, ExternalLink } from "lucide-react";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";

interface AgentCreateFormProps {
  initialData?: Agent;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const TONE_OPTIONS = [
  { value: "friendly", label: "Amigable" },
  { value: "professional", label: "Profesional" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
  { value: "creative", label: "Creativo" },
];

export function AgentCreateForm({ initialData, onSuccess, onCancel }: AgentCreateFormProps) {
  const { createAgent, updateAgent, isLoading, error } = useAgents();
  const { activeProviders } = useProviders();

  const [workspaceValidation, setWorkspaceValidation] = useState<{
    isValidating: boolean;
    exists: boolean;
    accessible: boolean;
    error?: string;
    message?: string;
  }>({ isValidating: false, exists: false, accessible: false });

  const [formData, setFormData] = useState<Partial<Agent>>({
    name: "",
    description: "",
    tone: "professional",
    provider_id: "",
    model_id: "",
    role: "coordinator" as "coordinator" | "worker",
    enabled: true,
    systemPrompt: "",
    workspace: initialData?.workspace || "",
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        provider_id: initialData.provider_id || initialData.providerId || "",
        model_id: initialData.model_id || initialData.modelId || "",
      });
    }
  }, [initialData]);

  const validateWorkspace = async (path: string) => {
    if (!path || path.trim() === "") {
      setWorkspaceValidation({ isValidating: false, exists: false, accessible: false });
      return;
    }

    setWorkspaceValidation({ isValidating: true, exists: false, accessible: false });

    try {
      const response = await apiClient<{
        exists: boolean;
        accessible: boolean;
        error?: string;
        message?: string;
      }>("/api/workspace/validate", {
        method: "POST",
        body: { path },
      });

      setWorkspaceValidation({
        isValidating: false,
        exists: response.exists,
        accessible: response.accessible,
        error: response.error,
        message: response.message,
      });
    } catch (err) {
      setWorkspaceValidation({
        isValidating: false,
        exists: false,
        accessible: false,
        error: (err as Error).message,
      });
    }
  };

  const handleCreateWorkspace = async () => {
    if (!formData.workspace) return;

    try {
      await apiClient("/api/workspace/create", {
        method: "POST",
        body: { path: formData.workspace },
        showLoader: "Creando directorio...",
        showSuccess: "Directorio creado exitosamente",
      });

      // Re-validar después de crear
      await validateWorkspace(formData.workspace);
    } catch (err) {
      swal.fire("Error", (err as Error).message, "error");
    }
  };

  const handleOpenWorkspace = async () => {
    if (!formData.workspace) return;

    try {
      await apiClient(`/api/workspace/open?path=${encodeURIComponent(formData.workspace)}`, {
        method: "GET",
      });
    } catch (err) {
      swal.fire("Error", (err as Error).message, "error");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.provider_id || !formData.model_id) {
      swal.fire("Incompleto", "Por favor selecciona un proveedor y modelo", "warning");
      return;
    }
    try {
      if (initialData?.id) {
        await updateAgent(initialData.id, formData);
      } else {
        await createAgent(formData);
      }
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
    }
  };

  const isEdit = !!initialData?.id;

  return (
    <Card className="hive-card--form group">
      {/* Decorative Glow */}
      <div className="hive-glow-blob--card absolute -top-24 -right-24 h-48 w-48 bg-blue-600/10 group-hover:bg-blue-600/20" style={{ borderRadius: "50%", filter: "blur(80px)" }} />

      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="hive-icon-wrap hive-icon-wrap--primary">
              {isEdit ? <Save className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </div>
            <div>
              <CardTitle className="text-xl font-bold text-white/90">
                {isEdit ? "Configurar Nodo" : "Desplegar Nuevo Nodo"}
              </CardTitle>
              <CardDescription className="text-white/40">
                {isEdit
                  ? "Ajusta los parámetros de tu agente inteligente."
                  : "Crea una nueva entidad inteligente para tu colmena."}
              </CardDescription>
            </div>
          </div>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel} className="text-white/40 hover:text-white hover:bg-white/5">
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="relative space-y-6 pt-2">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Main Info */}
          <div className="grid gap-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="hive-label--field">Nombre del Agente</Label>
              <Input
                id="name"
                placeholder="Ej: Analista de Mercado"
                className="hive-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="hive-label--field">Descripción / Rol</Label>
              <Textarea
                id="description"
                placeholder="Describe qué hace este agente y cuáles son sus objetivos..."
                className="hive-textarea"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="systemPrompt" className="hive-label--field">System Prompt</Label>
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-3 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/30 transition-colors">
                    Modifica acá el System Prompt
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-3xl bg-[#0a0a0c] border-white/10 text-white shadow-2xl [&>button]:text-white/50 hover:[&>button]:text-white">
                  <DialogHeader>
                    <DialogTitle className="text-xl">Editar System Prompt</DialogTitle>
                    <DialogDescription className="text-sm text-white/50">El prompt base de comportamiento del agente. Se recomienda formato Markdown.</DialogDescription>
                  </DialogHeader>
                  <div className="py-2">
                    <Textarea
                      value={formData.systemPrompt || ""}
                      onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                      className="min-h-[400px] font-mono text-sm bg-black/40 border-white/10 text-white/90 focus-visible:ring-blue-500/50 resize-y"
                      placeholder="Escribe el system prompt detallado aquí..."
                      disabled={isLoading}
                    />
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]">Guardar Cambios</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {formData.systemPrompt ? (
              <p className="text-xs text-white/40 line-clamp-1 italic border border-white/5 bg-white/[0.02] p-2 rounded-md">
                "{formData.systemPrompt}"
              </p>
            ) : (
              <p className="text-xs text-white/30 italic">Sin system prompt configurado...</p>
            )}
          </div>

          {/* Workspace Configuration */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <FolderOpen className="h-4 w-4 text-emerald-400" />
              <h3 className="hive-title-section">Workspace Directory</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace" className="hive-label--field">
                Directorio de Trabajo del Agente
              </Label>
              <div className="flex gap-2">
                <Input
                  id="workspace"
                  placeholder="Ej: /home/user/proyectos, D:\Work, /Volumes/USB"
                  className="hive-input flex-1 font-mono text-sm"
                  value={formData.workspace}
                  onChange={(e) => {
                    setFormData({ ...formData, workspace: e.target.value });
                    validateWorkspace(e.target.value);
                  }}
                  disabled={isLoading}
                />
                {formData.workspace && workspaceValidation.exists && workspaceValidation.accessible && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleOpenWorkspace}
                    className="shrink-0 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    title="Abrir en el explorador"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                Directorio donde el agente creará archivos, carpetas y ejecutará comandos. 
                Puede ser cualquier ubicación en tu sistema (disco duro, USB, red, etc.).
              </p>

              {/* Validation Status */}
              {formData.workspace && formData.workspace.trim() !== "" && (
                <div className={cn(
                  "flex items-center gap-2 text-xs p-2.5 rounded-lg border backdrop-blur-md transition-all",
                  workspaceValidation.isValidating && "bg-blue-500/10 border-blue-500/20 text-blue-400",
                  !workspaceValidation.isValidating && workspaceValidation.exists && workspaceValidation.accessible && "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                  !workspaceValidation.isValidating && workspaceValidation.exists && !workspaceValidation.accessible && "bg-amber-500/10 border-amber-500/20 text-amber-400",
                  !workspaceValidation.isValidating && !workspaceValidation.exists && "bg-purple-500/10 border-purple-500/20 text-purple-400"
                )}>
                  {workspaceValidation.isValidating && (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Validando directorio...</span>
                    </>
                  )}
                  {!workspaceValidation.isValidating && workspaceValidation.exists && workspaceValidation.accessible && (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>{workspaceValidation.message || "Directorio válido y accesible"}</span>
                    </>
                  )}
                  {!workspaceValidation.isValidating && workspaceValidation.exists && !workspaceValidation.accessible && (
                    <>
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{workspaceValidation.message || "El directorio existe pero no tiene permisos de lectura/escritura"}</span>
                    </>
                  )}
                  {!workspaceValidation.isValidating && !workspaceValidation.exists && (
                    <>
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>{workspaceValidation.message || "El directorio no existe"}</span>
                      {!workspaceValidation.error && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleCreateWorkspace}
                          className="ml-auto h-6 px-2 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-500/30"
                        >
                          Crear directorio
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="hive-card-divider" />

          {/* AI Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-blue-400" />
              <h3 className="hive-title-section">Motor de Inteligencia</h3>
            </div>
            <ModelSelector
              selectedProviderId={formData.provider_id || undefined}
              selectedModelId={formData.model_id || undefined}
              onProviderChange={(providerId) =>
                setFormData({ ...formData, provider_id: providerId, model_id: "" })
              }
              onModelChange={(modelId) => setFormData({ ...formData, model_id: modelId })}
              disabled={isLoading}
              typeFilter="llm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tone Selection */}
            <div className="space-y-2">
              <Label htmlFor="tone" className="hive-label--field">Tono de Voz</Label>
              <Select
                value={formData.tone}
                onValueChange={(tone) => setFormData({ ...formData, tone })}
                disabled={isLoading}
              >
                <SelectTrigger className="hive-select-trigger">
                  <SelectValue placeholder="Selecciona un tono" />
                </SelectTrigger>
                <SelectContent className="hive-select-content">
                  {TONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="hive-select-item">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status & Role */}
            <div className="hive-toggle-panel">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-purple-400" />
                  <Label htmlFor="role" className="text-xs font-medium text-white/70">Rol</Label>
                </div>
                <Select
                  value={formData.role}
                  onValueChange={(val) => setFormData({ ...formData, role: val as "coordinator" | "worker" })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="w-[120px] bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    <SelectItem value="coordinator">Coordinador</SelectItem>
                    <SelectItem value="worker">Worker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${formData.enabled ? "bg-blue-400" : "bg-zinc-600"}`} />
                  <Label htmlFor="enabled" className="text-xs font-medium text-white/70">Habilitado</Label>
                </div>
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {error && <div className="hive-form-error">{error}</div>}

          <div className="flex items-center gap-3 pt-4">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
                className="hive-btn--form-cancel"
              >
                Cancelar
              </Button>
            )}
            <Button
              type="submit"
              disabled={isLoading}
              className="hive-btn--form-submit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>{isEdit ? "Actualizar Agente" : "Desplegar Agente"}</>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
