import { useState, useEffect, useRef } from "react";
import { ShieldAlert, Save, Loader2, Plus, Check, Zap, Shield, Unlock, AlertTriangle } from "lucide-react";
import { useEthicsStore } from "@/stores/ethicsStore";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import { apiClient } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";



import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { EthicsConfig } from "@/types";

// Interfaz interna para manejar los datos que vienen de la API de base de datos
interface EthicsRecord extends EthicsConfig {
  name: string;
  description?: string;
  active: number;
  is_default?: number;
}

export function EthicsTemplateGallery() {
  const { configs, fetchEthics, isLoading } = useEthicsStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", content: "" });
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    if (isEditing) {
      setTimeout(adjustHeight, 0);
    }
  }, [isEditing, editForm.content]);

  useEffect(() => {
    fetchEthics().catch(console.error);
  }, [fetchEthics]);

  useEffect(() => {
    if (configs.length === 0) return;
    const records = configs as unknown as EthicsRecord[];
    const active = records.find(e => e.active) || records[0];
    if (!selectedId) {
      setSelectedId(active.id);
      setEditForm({
        name: active.name,
        description: active.description || "",
        content: active.content
      });
    }
  }, [configs, selectedId]);

  const selected = (configs as unknown as EthicsRecord[]).find(e => e.id === selectedId);

  const handleSelect = (record: EthicsRecord) => {
    setSelectedId(record.id);
    setEditForm({
      name: record.name,
      description: record.description || "",
      content: record.content
    });
    setIsEditing(true);
  };

  const handleSetActive = async (id: string) => {
    loader.show("Activando registro de ética...");
    const records = configs as unknown as EthicsRecord[];
    try {
      const results = await Promise.all(
        records.map(e =>
          apiClient<{ message?: string }>(`/api/ethics/${e.id}`, {
            method: "PUT",
            body: { active: e.id === id ? 1 : 0 },
          }).catch(() => ({} as { message?: string }))
        )
      );
      await fetchEthics();
      const activeResult = results.find((_, i) => records[i].id === id);
      Toast.fire({ icon: "success", title: activeResult?.message || "Registro de ética activado" });
    } catch (err) {
      Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al activar registro" });
    } finally {
      loader.hide();
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setIsSaving(true);
    loader.show("Guardando lineamientos éticos...");
    try {
      const data = await apiClient<{ message?: string }>(`/api/ethics/${selected.id}`, {
        method: "PUT",
        body: editForm,
      });
      await fetchEthics();
      Toast.fire({ icon: "success", title: data.message || "Contenido ético guardado" });
    } catch (err) {
      Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al guardar" });
    } finally {
      setIsSaving(false);
      loader.hide();
      setIsEditing(false);
    }
  };

  const handleApplyTemplate = (templateContent: string) => {
    setEditForm(p => ({ ...p, content: templateContent }));
    Toast.fire({ icon: "info", title: "Plantilla aplicada — guarda para confirmar" });
  };



  if (isLoading && configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 border border-white/5 bg-zinc-950/30 rounded-2xl">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mb-4 opacity-50" />
        <span className="hive-label">Cargando lineamientos operativos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="hive-title-section !text-lg">Protocolos Éticos</h3>
            <span className="hive-tag hive-tag--provider">
              {configs.length} REGISTROS
            </span>
          </div>
          <p className="hive-subtitle !mt-0 !text-xs">
            Define la capa moral y los límites operacionales de tus agentes inteligentes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-white/20 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
          <Shield className="h-3.5 w-3.5" />
          <span>Configuración del Núcleo</span>
        </div>
      </div>

      {/* ── Records grid ──────────────────────────────────────────────────── */}
      {configs.length === 0 ? (
        <div className="hive-card border-dashed border-white/10 bg-white/[0.02]">
          <div className="hive-card-body flex flex-col items-center justify-center py-16 px-4">
            <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-white/20" />
            </div>
            <div className="text-center">
              <p className="hive-title-section text-center mb-2">Sin Protocolos Base</p>
              <p className="text-xs text-white/40 mb-8 max-w-[300px] mx-auto leading-relaxed">
                No se han detectado lineamientos éticos en el sistema. Selecciona una de las plantillas inferiores para comenzar.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {(configs as EthicsRecord[]).map(record => {
            const isActive = !!record.active;
            const isSelected = selectedId === record.id;
            return (
              <div
                key={record.id}
                onClick={() => handleSelect(record)}
                className={`hive-card group transition-all duration-500 cursor-pointer ${isSelected
                  ? 'hive-card--active'
                  : 'opacity-60 grayscale-[0.8] hover:opacity-100 hover:grayscale-0'
                  }`}
              >
                <div className="hive-card-body relative overflow-hidden">
                  <div className="flex items-start justify-between mb-6">
                    <div className={`hive-icon-wrap--internal ${isSelected
                      ? 'hive-icon-wrap--internal-active'
                      : 'hive-icon-wrap--internal-disabled'
                      }`}>
                      <ShieldAlert className="h-6 w-6" />
                    </div>

                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="hive-status-label--active">
                          ACTIVO
                        </span>
                      )}
                      <div className={isActive ? "hive-status-dot--active" : "hive-status-dot--disabled"} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-1 line-clamp-1 group-hover:text-blue-400 transition-colors text-ellipsis">
                        {record.name}
                      </h3>
                      <p className="text-xs text-white/40 font-medium leading-relaxed line-clamp-1 h-4">
                        {record.description || "Sin descripción adicional"}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-white/5 flex items-center gap-4">
                      <div className="hive-stat">
                        <span className="hive-stat__label">CONFIG</span>
                        <span className="hive-stat__value">{record.is_default ? "DEFAULT" : "CUSTOM"}</span>
                      </div>
                      <div className="hive-stat">
                        <span className="hive-stat__label">PRECEDENCIA</span>
                        <span className="hive-stat__value">{isActive ? "ALTA" : "NORMAL"}</span>
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="hive-glow-blob--card hive-glow-blob--blue -bottom-10 -right-10 h-24 w-24 opacity-20" />
                  )}
                </div>
                <div className={`hive-strip--bottom ${!isActive ? 'opacity-20' : ''}`} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Editor Dialog ────────────────────────────────────────────────── */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-4xl border-white/10 !bg-[#09090b] p-0 overflow-hidden shadow-2xl">
          {selected && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5 relative overflow-hidden">
                <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-20" />
                <div className="flex items-center gap-4 relative z-10">
                  <div className="hive-icon-wrap--internal hive-icon-wrap--internal-active">
                    <Shield className="h-6 w-6" />
                  </div>
                  <div>
                    <DialogTitle className="hive-title-page !text-2xl uppercase tracking-tighter">{selected.name}</DialogTitle>
                    <DialogDescription className="hive-subtitle !mt-0">Sintonización de la capa moral y operativa del agente.</DialogDescription>
                  </div>
                </div>

                <div className="flex items-center gap-3 relative z-10">
                  {!selected.active && (
                    <button
                      className="hive-btn hive-btn--ghost px-6 text-[10px]"
                      onClick={() => handleSetActive(selected.id)}
                    >
                      ESTABLECER COMO ACTIVO
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-4 border-b border-white/5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="hive-label uppercase !text-[10px]">Nombre del Protocolo</Label>
                    <Input
                      value={editForm.name}
                      onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                      className="bg-white/5 border-white/5 focus-visible:ring-blue-500/30 text-white font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="hive-label uppercase !text-[10px]">Descripción / Meta</Label>
                    <Input
                      value={editForm.description}
                      onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                      className="bg-white/5 border-white/5 focus-visible:ring-blue-500/30 text-white/60 text-xs italic"
                    />
                  </div>
                </div>
              </div>

              <div className="p-0 bg-[#09090b]">
                <div className="px-6 pt-4">
                  <Label className="hive-label uppercase !text-[10px]">Lineamientos de Capa (Markdown)</Label>
                </div>
                <Textarea
                  ref={textareaRef}
                  placeholder="Define los lineamientos éticos del agente..."
                  value={editForm.content}
                  onChange={e => {
                    setEditForm(p => ({ ...p, content: e.target.value }));
                    adjustHeight();
                  }}
                  className="hive-textarea w-full !bg-zinc-950/50 border-none focus-visible:ring-0 text-amber-50/90 font-mono text-xs leading-relaxed min-h-[400px] p-8 resize-none placeholder:text-white/10 overflow-hidden"
                />
              </div>

              <div className="p-6 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="hive-stat">
                    <span className="hive-stat__label">IDENTIFICADOR</span>
                    <span className="hive-stat__value">{selected.id}</span>
                  </div>
                  <div className="hive-stat">
                    <span className="hive-stat__label">ESTADO DE CAPA</span>
                    <span className="hive-stat__value hive-stat__value--active">{selected.active ? "SISTEMA ACTIVO" : "PENDIENTE"}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button
                    className="hive-btn hive-btn--ghost px-6 text-[10px]"
                    onClick={() => setIsEditing(false)}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="hive-btn hive-btn--primary px-8 text-[10px]"
                  >
                    {isSaving ? "SINCRONIZANDO..." : "GUARDAR LINEAMIENTOS"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>



    </div>
  );
}
