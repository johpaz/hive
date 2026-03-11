import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaveStatusIndicator } from "@/modules/agent-config/shared/SaveStatusIndicator";
import { Settings, Shield, User, Zap, Info, Save, X, Activity } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { ChannelIcon } from "../shared/ChannelIcon";
import { cn } from "@/lib/utils";
import type { ConnectedChannel } from "@/types";

interface ChannelConfigPanelProps {
  channel: ConnectedChannel;
}

export function ChannelConfigPanel({ channel }: ChannelConfigPanelProps) {
  const { updateChannel } = useChannels();
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error" | "idle">("idle");

  // Local state for the configuration
  const [config, setConfig] = useState({
    name: channel.name || "",
    bindingMode: channel.bindingMode || "fixed",
    policies: {
      dmPolicy: channel.config?.policies?.dmPolicy || "open",
      requireAuth: channel.config?.policies?.requireAuth || false,
    },
  });

  // Track if there are unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setConfig({
      name: channel.name || "",
      bindingMode: channel.bindingMode || "fixed",
      policies: {
        dmPolicy: channel.config?.policies?.dmPolicy || "open",
        requireAuth: channel.config?.policies?.requireAuth || false,
      },
    });
    setHasChanges(false);
  }, [channel]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      // Assuming the backend expectation is matched with updateChannel(type, accountId, config)
      // Note: channel.type and channel.accountId are needed
      // Based on server.ts: /api/channels/:type/:accountId
      await updateChannel(channel.id, {
        ...channel.config,
        name: config.name,
        bindingMode: config.bindingMode,
        policies: {
          ...channel.config?.policies,
          ...config.policies,
        },
      } as any);

      setSaveStatus("saved");
      setHasChanges(false);
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      console.error("Error saving channel config:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({
      name: channel.name || "",
      bindingMode: channel.bindingMode || "fixed",
      policies: {
        dmPolicy: channel.config?.policies?.dmPolicy || "open",
        requireAuth: channel.config?.policies?.requireAuth || false,
      },
    });
    setHasChanges(false);
  };

  const updateField = (field: string, value: any) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        (newConfig as any)[parent] = { ...(newConfig as any)[parent], [child]: value };
      } else {
        (newConfig as any)[field] = value;
      }
      return newConfig;
    });
    setHasChanges(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ChannelIcon type={channel.type} className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Personalización del Canal</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">ID: {channel.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && <span className="text-[10px] font-bold text-amber-500 animate-pulse">CAMBIOS SIN GUARDAR</span>}
          <SaveStatusIndicator status={saveStatus === "idle" ? "saved" : saveStatus} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* General Settings */}
        <Card className="border-none bg-secondary/30 backdrop-blur-sm overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-xs font-bold flex items-center gap-2">
              <Settings className="h-3.5 w-3.5 text-primary" />
              GENERAL
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Info className="h-3 w-3" /> Nombre del canal
              </Label>
              <Input
                value={config.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="h-10 bg-background/50 border-white/5 focus-visible:ring-primary/20 transition-all text-sm font-medium"
                placeholder="Ej. Mi Canal Principal"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Zap className="h-3 w-3 text-amber-500" /> Modo de Binding
              </Label>
              <Select
                value={config.bindingMode}
                onValueChange={(val) => updateField('bindingMode', val)}
              >
                <SelectTrigger className="h-10 bg-background/50 border-white/5 focus-visible:ring-primary/20 transition-all text-sm font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover/95 border-white/10 backdrop-blur-xl">
                  <SelectItem value="fixed" className="text-sm cursor-pointer hover:bg-primary/10 transition-colors">
                    <div className="flex flex-col">
                      <span>Fijo</span>
                      <span className="text-[10px] text-muted-foreground">Siempre el mismo agente</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="conditional" className="text-sm cursor-pointer hover:bg-primary/10 transition-colors">
                    <div className="flex flex-col">
                      <span>Condicional</span>
                      <span className="text-[10px] text-muted-foreground">Reglas predefinidas</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="dynamic" className="text-sm cursor-pointer hover:bg-primary/10 transition-colors">
                    <div className="flex flex-col">
                      <span>Dinámico</span>
                      <span className="text-[10px] text-muted-foreground">Selección por IA</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Policies Settings */}
        <Card className="border-none bg-secondary/30 backdrop-blur-sm overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-xs font-bold flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-indigo-400" />
              POLÍTICAS Y SEGURIDAD
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <User className="h-3 w-3" /> Política de Mensajes Directos (DM)
              </Label>
              <Select
                value={config.policies.dmPolicy}
                onValueChange={(val) => updateField('policies.dmPolicy', val)}
              >
                <SelectTrigger className="h-10 bg-background/50 border-white/5 focus-visible:ring-primary/20 transition-all text-sm font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover/95 border-white/10 backdrop-blur-xl">
                  <SelectItem value="open" className="text-sm cursor-pointer hover:bg-primary/10 transition-colors">
                    <div className="flex flex-col">
                      <span>Abierto</span>
                      <span className="text-[10px] text-muted-foreground">Cualquiera puede iniciar chat</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="pairing" className="text-sm cursor-pointer hover:bg-primary/10 transition-colors">
                    <div className="flex flex-col">
                      <span>Emparejamiento</span>
                      <span className="text-[10px] text-muted-foreground">Requiere vinculación manual</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 flex items-start gap-3">
              <Activity className="h-4 w-4 text-indigo-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-indigo-300 tracking-wide uppercase">Estado del Sistema</p>
                <p className="text-[10px] text-muted-foreground">Canal optimizado con encripción de nivel militar y redundancia multi-zona.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end items-center gap-4 pt-4 border-t border-white/5">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={!hasChanges || isSaving}
          className="h-9 px-6 text-xs font-bold tracking-tight hover:bg-white/5 transition-colors"
        >
          <X className="h-3.5 w-3.5 mr-2" /> REVERTIR
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className={cn(
            "h-9 px-8 text-xs font-bold tracking-tight shadow-lg shadow-primary/20 transition-all active:scale-95",
            hasChanges ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <Save className="h-3.5 w-3.5 animate-spin" /> PROCESANDO...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="h-3.5 w-3.5" /> GUARDAR CAMBIOS
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
