import { useState, useEffect } from "react";
import { User, Save, Loader2, type LucideProps, Cpu, Sparkles, Shield, Activity, Globe, FolderOpen, ExternalLink, Check, AlertCircle } from "lucide-react";
import { useAgents, useProviders, useModels } from "@/stores/useGlobalConfigStore";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";

// Wrapper to fix React 19 + Lucide type compatibility
function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
    return <IconComponent {...props} />;
}

interface AgentDetailsEditorProps {
    agentId: string;
}

export function AgentDetailsEditor({ agentId }: AgentDetailsEditorProps) {
    const { agents, updateAgent, fetchAgents } = useAgents();
    const { providers, fetchProviders } = useProviders();
    const { models, fetchModels } = useModels();

    useEffect(() => {
        fetchAgents();
        fetchProviders();
        fetchModels();
    }, [fetchAgents, fetchProviders, fetchModels]);

    const agent = agents.find(a => a.id === agentId);

    const [formData, setFormData] = useState({
        name: "",
        description: "",
        provider_id: "",
        model_id: "",
        tone: "",
        role: "coordinator" as "coordinator" | "worker",
        enabled: true,
        headers: "",
        systemPrompt: "",
        workspace: "",
    });

    const [workspaceValidation, setWorkspaceValidation] = useState<{
        isValidating: boolean;
        exists: boolean;
        accessible: boolean;
        error?: string;
        message?: string;
    }>({ isValidating: false, exists: false, accessible: false });

    useEffect(() => {
        if (agent) {
            setFormData({
                name: agent.name || "",
                description: agent.description || "",
                provider_id: agent.provider_id || agent.providerId || "",
                model_id: agent.model_id || agent.modelId || "",
                tone: agent.tone || "",
                role: agent.role || "coordinator",
                enabled: !!agent.enabled,
                headers: "",
                systemPrompt: agent.systemPrompt || "",
                workspace: agent.workspace || "",
            });
            // Validar workspace inicial si existe
            if (agent.workspace) {
                validateWorkspace(agent.workspace);
            }
        }
    }, [agent]);

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

            await validateWorkspace(formData.workspace);
        } catch (err) {
            Toast.fire({ icon: "error", title: (err as Error).message });
        }
    };

    const handleOpenWorkspace = async () => {
        if (!formData.workspace) return;

        try {
            await apiClient(`/api/workspace/open?path=${encodeURIComponent(formData.workspace)}`, {
                method: "GET",
            });
        } catch (err) {
            Toast.fire({ icon: "error", title: (err as Error).message });
        }
    };

    const handleSave = async () => {
        loader.show("Sincronizando configuración del agente...");
        try {
            await updateAgent(agentId, {
                ...formData,
                role: formData.role,
                enabled: formData.enabled ? 1 : 0,
                workspace: formData.workspace || null,
            });
            Toast.fire({ icon: "success", title: "Cambios sincronizados correctamente" });
        } catch (err) {
            Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al sincronizar cambios" });
        } finally {
            loader.hide();
        }
    };

    if (!agent) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 rounded-3xl border border-dashed border-white/10 bg-white/5">
                <Icon icon={Activity as any} className="h-12 w-12 text-white/10 animate-pulse" />
                <p className="text-white/40 font-medium">Buscando nodo en la colmena...</p>
            </div>
        );
    }

    // Providers disponibles: enabled=1 Y active=1
    const activeProviders = providers.filter(p => p.enabled && p.active);

    // Modelos del provider seleccionado que estén enabled=1 Y active=1
    const availableModels = models.filter(m => {
        const pid = m.provider_id || m.providerId;
        return pid === formData.provider_id && m.active && m.enabled;
    });

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Form Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Identity Sidebar */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="p-6 rounded-3xl border border-white/10 bg-black/20 backdrop-blur-md space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                <Icon icon={User as any} className="h-4 w-4 text-blue-400" />
                            </div>
                            <h3 className="font-bold text-white uppercase tracking-wider text-xs">Identidad Base</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-xs text-white/40 uppercase tracking-widest pl-1">Nombre Público</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    className="bg-white/5 border-white/10 focus:border-blue-500/50 rounded-xl h-11"
                                    placeholder="Nombre del nodo"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="tone" className="text-xs text-white/40 uppercase tracking-widest pl-1">Tono Cognitivo</Label>
                                <Input
                                    id="tone"
                                    value={formData.tone}
                                    onChange={(e) => setFormData(prev => ({ ...prev, tone: e.target.value }))}
                                    className="bg-white/5 border-white/10 focus:border-blue-500/50 rounded-xl h-11"
                                    placeholder="Ej: Analítico, Conciso..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-6 rounded-3xl border border-white/10 bg-black/20 backdrop-blur-md space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                                <Icon icon={Shield as any} className="h-4 w-4 text-purple-400" />
                            </div>
                            <h3 className="font-bold text-white uppercase tracking-wider text-xs">Permisos de Red</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-semibold">Rol</Label>
                                    <p className="text-[10px] text-white/30">Coordinador o Worker</p>
                                </div>
                                <Select
                                    value={formData.role}
                                    onValueChange={(val) => setFormData(prev => ({ ...prev, role: val as "coordinator" | "worker" }))}
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

                            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-semibold">Nodo Activo</Label>
                                    <p className="text-[10px] text-white/30">Disponible para la colmena</p>
                                </div>
                                <Switch
                                    checked={formData.enabled}
                                    onCheckedChange={(val) => setFormData(prev => ({ ...prev, enabled: val }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Workspace Configuration Panel */}
                    <div className="p-6 rounded-3xl border border-white/10 bg-black/20 backdrop-blur-md space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <Icon icon={FolderOpen as any} className="h-4 w-4 text-emerald-400" />
                            </div>
                            <h3 className="font-bold text-white uppercase tracking-wider text-xs">Workspace Directory</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="workspace" className="text-xs text-white/40 uppercase tracking-widest pl-1">
                                    Directorio de Trabajo
                                </Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="workspace"
                                        value={formData.workspace}
                                        onChange={(e) => {
                                            setFormData(prev => ({ ...prev, workspace: e.target.value }));
                                            validateWorkspace(e.target.value);
                                        }}
                                        className="bg-white/5 border-white/10 focus:border-emerald-500/50 rounded-xl h-11 font-mono text-sm flex-1"
                                        placeholder="Ej: /home/user/proyectos, D:\Work"
                                    />
                                    {formData.workspace && workspaceValidation.exists && workspaceValidation.accessible && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleOpenWorkspace}
                                            className="shrink-0 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-11 w-11"
                                            title="Abrir en el explorador"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                                <p className="text-xs text-white/40 leading-relaxed">
                                    Directorio donde el agente operará. Puede ser cualquier ubicación (disco, USB, red).
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
                                                <span>{workspaceValidation.message || "Sin permisos de lectura/escritura"}</span>
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
                                                        Crear
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Cognitive Config */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="p-8 rounded-3xl border border-white/10 bg-black/20 backdrop-blur-md space-y-8">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                    <Icon icon={Sparkles as any} className="h-4 w-4 text-amber-400" />
                                </div>
                                <h3 className="font-bold text-white uppercase tracking-wider text-xs">Configuración Cognitiva</h3>
                            </div>

                            <Button
                                onClick={handleSave}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl px-6 shadow-[0_4px_15px_rgba(37,99,235,0.3)] transition-all active:scale-95 gap-2"
                            >
                                <Icon icon={Save as any} className="h-4 w-4" />
                                Sincronizar Cambios
                            </Button>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="description" className="text-xs text-white/40 uppercase tracking-widest pl-1">Directiva de Misión (Descripción)</Label>
                                <Textarea
                                    id="description"
                                    value={formData.description}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    className="bg-white/5 border-white/10 focus:border-blue-500/50 rounded-2xl min-h-[80px] resize-none"
                                    placeholder="Define el propósito general de este nodo..."
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between pl-1">
                                    <Label className="text-xs text-white/40 uppercase tracking-widest">System Prompt (Markdown)</Label>
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button type="button" variant="outline" size="sm" className="h-7 px-3 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/30 transition-colors">
                                                Modifica acá el System Prompt
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-3xl bg-[#0a0a0c] border-white/10 text-white shadow-2xl [&>button]:text-white/50 hover:[&>button]:text-white">
                                            <DialogHeader>
                                                <DialogTitle className="text-xl">Editar System Prompt</DialogTitle>
                                                <DialogDescription className="text-sm text-white/50">El comportamiento principal del agente. Se recomienda usar Markdown.</DialogDescription>
                                            </DialogHeader>
                                            <div className="py-2">
                                                <Textarea
                                                    value={formData.systemPrompt}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                                                    className="min-h-[400px] font-mono text-sm bg-black/40 border-white/10 text-white/90 focus-visible:ring-blue-500/50 resize-y"
                                                    placeholder="Escribe el system prompt detallado aquí..."
                                                />
                                            </div>
                                            <DialogFooter>
                                                <DialogClose asChild>
                                                    <Button type="button" className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]">Listo</Button>
                                                </DialogClose>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                                {formData.systemPrompt ? (
                                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 max-h-[120px] overflow-y-auto custom-scrollbar">
                                        <p className="text-xs text-white/60 font-mono whitespace-pre-wrap italic">
                                            {formData.systemPrompt}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                                        <p className="text-xs text-white/30 italic">Sin system prompt configurado...</p>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Provider selector */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between pl-1">
                                        <Label className="text-xs text-white/40 uppercase tracking-widest">Proveedor</Label>
                                        {activeProviders.length === 0 && (
                                            <span className="text-[10px] text-amber-400/80">Sin providers activos</span>
                                        )}
                                    </div>
                                    <Select
                                        value={formData.provider_id}
                                        onValueChange={(val) => setFormData(prev => ({ ...prev, provider_id: val, model_id: "" }))}
                                    >
                                        <SelectTrigger className="bg-white/5 border-white/10 rounded-xl h-11">
                                            <SelectValue placeholder="Seleccionar proveedor" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                            {activeProviders.length === 0 && (
                                                <div className="px-3 py-4 text-center text-xs text-white/30">
                                                    Activa al menos un provider en la sección de Providers
                                                </div>
                                            )}
                                            {activeProviders.map(p => {
                                                const baseUrl = p.base_url || p.baseUrl || "";
                                                const isLocal = p.id === "ollama" || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
                                                return (
                                                    <SelectItem key={p.id} value={p.id}>
                                                        <div className="flex items-center gap-2">
                                                            <span>{p.name}</span>
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isLocal
                                                                    ? "bg-amber-500/20 text-amber-400"
                                                                    : "bg-emerald-500/20 text-emerald-400"
                                                                }`}>
                                                                {isLocal ? "LOCAL" : "API"}
                                                            </span>
                                                        </div>
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Model selector */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between pl-1">
                                        <Label className="text-xs text-white/40 uppercase tracking-widest">Modelo</Label>
                                        {formData.provider_id && availableModels.length === 0 && (
                                            <span className="text-[10px] text-amber-400/80">Sin modelos activos</span>
                                        )}
                                    </div>
                                    <Select
                                        value={formData.model_id}
                                        onValueChange={(val) => setFormData(prev => ({ ...prev, model_id: val }))}
                                        disabled={!formData.provider_id || availableModels.length === 0}
                                    >
                                        <SelectTrigger className="bg-white/5 border-white/10 rounded-xl h-11 disabled:opacity-50">
                                            <SelectValue placeholder={
                                                !formData.provider_id
                                                    ? "Primero selecciona un proveedor"
                                                    : availableModels.length === 0
                                                        ? "Activa modelos en el provider"
                                                        : "Seleccionar modelo"
                                            } />
                                        </SelectTrigger>
                                        <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                            {availableModels.map(m => (
                                                <SelectItem key={m.id} value={m.id}>
                                                    <span className="font-mono text-sm">{m.name}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        {/* Security Notice */}
                        <div className="mt-8 p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-start gap-4 italic">
                            <Icon icon={Globe as any} className="h-5 w-5 text-white/20 mt-0.5" />
                            <p className="text-[11px] text-white/30 leading-relaxed">
                                Las credenciales de acceso y llaves de cifrado para los headers personalizados se gestionan en una capa segura y no son visibles en texto plano para mantener la integridad de la red.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
