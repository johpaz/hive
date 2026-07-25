import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Wrench, AlertTriangle, Settings2, Globe2, Terminal, Search, LayoutGrid } from "lucide-react";
import { useTools } from "@/hooks/useProviders";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";

const CATEGORIES = ["filesystem", "web", "cron", "cli", "agents"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  filesystem: "Sistema de archivos",
  web: "Web",
  cron: "Cron",
  cli: "CLI",
  agents: "Agentes",

};

export function ToolManager() {
  const { tools, isLoading, fetchTools, toggleTool, updateTool } = useTools();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [editingTool, setEditingTool] = useState<any>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const handleToggle = async (id: string, active: boolean) => {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await toggleTool(id, active);
      fetchTools();
      Toast.fire({ icon: "success", title: `Herramienta ${active ? "activada" : "desactivada"}` });
    } catch {
      Toast.fire({ icon: "error", title: "Error al actualizar estado de la herramienta" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleSave = async () => {
    if (!editingTool) return;
    setIsSaving(true);
    loader.show("Guardando herramienta...");
    try {
      await updateTool(editingTool.id, {
        name: editingTool.name,
        description: editingTool.description,
      });
      Toast.fire({ icon: "success", title: "Herramienta actualizada" });
      fetchTools();
      setEditingTool(null);
    } catch {
      Toast.fire({ icon: "error", title: "Error al guardar cambios" });
    } finally {
      setIsSaving(false);
      loader.hide();
    }
  };

  if (isLoading && tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 border border-white/5 bg-zinc-950/30 rounded-2xl">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500 mb-4 opacity-50" />
        <span className="text-xs uppercase font-bold tracking-[0.2em] text-zinc-500">Cargando herramientas...</span>
      </div>
    );
  }

  const filteredTools = tools.filter(tool =>
    activeTab === "all" ? true : tool.category === activeTab
  );

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="hive-title-section !text-lg !text-white/80">Herramientas</h3>
            <span className="hive-tag bg-white/5 text-white/40 border-white/10">
              {filteredTools.length} DISPONIBLES
            </span>
          </div>
          <p className="hive-subtitle !mt-0 !text-xs">
            Gestiona las capacidades externas y el arsenal tecnológico de tu agente.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-white/20 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
          <Wrench className="h-3.5 w-3.5" />
          <span>Arsenal Operativo</span>
        </div>
      </div>

      {/* ── Tabs/Categorías ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-2xl w-fit border border-white/5">
        {(["all", "filesystem", "web", "cron", "cli", "agents", "a2ui"] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all duration-300 ${activeTab === cat
              ? 'bg-blue-600 text-white shadow-btn-primary'
              : 'text-white/20 hover:text-white/40 hover:bg-white/5'
              }`}
          >
            {cat === "all" ? "TODAS" : CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* ── Tool cards ────────────────────────────────────────────────────── */}
      {filteredTools.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-zinc-950/20 group hover:border-violet-500/20 transition-colors">
          <div className="p-4 rounded-full bg-zinc-900 mb-4 group-hover:scale-110 transition-transform">
            <AlertTriangle className="h-8 w-8 text-zinc-700 group-hover:text-violet-500/50 transition-colors" />
          </div>
          <p className="text-xs text-zinc-500 font-medium">Sin herramientas en esta categoría.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTools.map(tool => {
            const isActive = tool.active;
            const isCore = tool.core;
            return (
              <div
                key={tool.id}
                onClick={() => setEditingTool({ ...tool })}
                className={`hive-card group cursor-pointer transition-all duration-500 ${isActive
                  ? 'hive-card--active'
                  : 'hive-card--disabled'
                  }`}
              >
                <div className="hive-card-body relative overflow-hidden">
                  <div className="flex items-start justify-between mb-6">
                    <div className={`hive-icon-wrap--internal ${isActive
                      ? 'hive-icon-wrap--internal-active'
                      : 'hive-icon-wrap--internal-disabled'
                      }`}>
                      {tool.category === 'filesystem' && <Globe2 className="h-6 w-6" />}
                      {tool.category === 'web' && <Globe2 className="h-6 w-6" />}
                      {tool.category === 'cron' && <Search className="h-6 w-6" />}
                      {tool.category === 'cli' && <Terminal className="h-6 w-6" />}
                      {tool.category === 'agents' && <Settings2 className="h-6 w-6" />}

                    </div>

                    <div className="flex items-center gap-2">
                      {isCore && (
                        <span className="hive-status-label--active">
                          NATIVO
                        </span>
                      )}
                      <Switch
                        checked={isActive}
                        onCheckedChange={() => handleToggle(tool.id, !isActive)}
                        onClick={(e) => e.stopPropagation()}
                        className="data-[state=checked]:bg-blue-500 scale-75 origin-right"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-1 line-clamp-1 group-hover:text-blue-400 transition-colors">
                        {tool.name}
                      </h3>
                      <p className="hive-subtitle !mt-0 !text-[11px] h-8 line-clamp-2">
                        {tool.description || "Sin descripción disponible"}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-white/5 flex items-center gap-4">
                      <div className="hive-stat">
                        <span className="hive-stat__label">TIPO</span>
                        <span className="hive-stat__value truncate max-w-[80px]">{tool.category}</span>
                      </div>
                      <div className="hive-stat">
                        <span className="hive-stat__label">ESTADO</span>
                        <div className="flex items-center gap-2">
                          <div className={isActive ? "hive-status-dot--active" : "hive-status-dot--disabled"} />
                          <span className={isActive ? "hive-status-label--active" : "hive-status-label--disabled"}>
                            {isActive ? "ACTIVE" : "STANDBY"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <div className="hive-glow-blob--card hive-glow-blob--blue -bottom-10 -right-10 h-24 w-24 opacity-20" />
                  )}
                </div>
                <div className={`hive-strip--bottom ${!isActive ? 'opacity-20' : ''}`} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!editingTool} onOpenChange={open => !open && setEditingTool(null)}>
        <DialogContent className="sm:max-w-sm bg-zinc-950 border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
                <Settings2 className="h-3.5 w-3.5" />
              </div>
              Editar herramienta
            </DialogTitle>
            <DialogDescription className="text-[10px] text-zinc-500 font-medium">
              Modifica los parámetros y la descripción de la herramienta seleccionada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Nombre</Label>
              <Input
                value={editingTool?.name || ""}
                onChange={e => setEditingTool({ ...editingTool, name: e.target.value })}
                className="h-9 text-sm bg-white/5 border-white/10 focus:border-violet-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Descripción</Label>
              <Textarea
                value={editingTool?.description || ""}
                onChange={e => setEditingTool({ ...editingTool, description: e.target.value })}
                className="text-sm min-h-[80px] resize-none bg-white/5 border-white/10 focus:border-violet-500/50 font-mono"
              />
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-white/5">
              <span className="font-mono text-[10px] bg-zinc-900 border border-white/5 text-zinc-500 px-2 py-0.5 rounded truncate max-w-[180px]">
                {editingTool?.id}
              </span>
              <Badge variant="outline" className="text-[9px] border-zinc-800 text-zinc-500 uppercase">
                {editingTool?.category}
              </Badge>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingTool(null)}
              className="hive-btn--form-cancel h-10"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="hive-btn--form-submit h-10"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
