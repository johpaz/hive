import { useState, useEffect, useRef } from "react";
import { Wand2, Loader2, Save, Info, Sparkles, Cpu } from "lucide-react";
import { useSkills } from "@/hooks/useProviders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import { SkillCard } from "./SkillCard";
import type { Skill } from "@/types";

export function SkillsTab() {
  const { skills, isLoading, fetchSkills, toggleSkill, updateSkill } = useSkills();
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editForm, setEditForm] = useState({ 
    name: "", 
    body: "", 
    tools: "", 
    triggers: "", 
    category: "",
    version: 1,
    active: true
  });
  const [togglingId, setTogglingId] = useState<string | null>(null);
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
    if (editingSkill) {
      // Small delay to ensure the dialog is rendered before adjusting height
      setTimeout(adjustHeight, 0);
    }
  }, [editingSkill, editForm.body]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleToggle = async (id: string, active: boolean) => {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await toggleSkill(id, active);
      Toast.fire({ icon: "success", title: active ? "Skill habilitado" : "Skill deshabilitado" });
    } catch {
      Toast.fire({ icon: "error", title: "Error al cambiar estado del skill" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleOpenEdit = (skill: any) => {
    setEditingSkill(skill);
    setEditForm({
      name: skill.name,
      body: skill.body || "",
      tools: skill.tools || "",
      triggers: skill.triggers || "",
      category: skill.category || "",
      version: Number(skill.version) || 1,
      active: !!skill.active
    });
  };

  const handleSave = async () => {
    if (!editingSkill) return;
    setIsSaving(true);
    loader.show("Guardando skill...");
    try {
      await updateSkill(editingSkill.id, editForm);
      Toast.fire({ icon: "success", title: "Skill actualizado correctamente" });
      fetchSkills();
      setEditingSkill(null);
    } catch {
      Toast.fire({ icon: "error", title: "Error al actualizar skill" });
    } finally {
      setIsSaving(false);
      loader.hide();
    }
  };

  if (isLoading && skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
          <Sparkles className="h-4 w-4 text-primary absolute -top-1 -right-1 animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground animate-pulse">Cargando habilidades premium...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="hive-title-section !text-lg">Habilidades del Sistema</h3>
            <span className="hive-tag bg-blue-500/10 text-blue-400 border-blue-500/20">
              {skills.length} ACTIVAS
            </span>
          </div>
          <p className="hive-subtitle !mt-0 !text-xs">
            Gestiona los módulos cognitivos que otorgan capacidades autónomas a tus agentes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-white/20 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
          <Info className="h-3.5 w-3.5" />
          <span>Click en skill para configurar</span>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="hive-card border-dashed border-white/10 bg-white/[0.02]">
          <div className="hive-card-body flex flex-col items-center justify-center py-16 px-4">
            <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
              <Wand2 className="h-8 w-8 text-white/20" />
            </div>
            <div className="text-center">
              <p className="hive-title-section text-center mb-2">No se detectan habilidades</p>
              <p className="text-xs text-white/40 mb-8 max-w-[300px] mx-auto leading-relaxed">
                El repositorio de habilidades está vacío. Visita el Marketplace para descargar nuevos nodos cognitivos.
              </p>
            </div>
            <button className="hive-btn hive-btn--primary px-8">
              Explorar Marketplace
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {skills.map(skill => (
            <div key={skill.id} className="relative">
              <SkillCard
                skill={skill}
                onClick={() => handleOpenEdit(skill)}
              />
              <div className="absolute top-6 right-6 z-20 pointer-events-auto flex items-center gap-2">
                <span className={`text-[9px] font-black tracking-widest ${skill.active ? 'text-blue-400' : 'text-white/20'}`}>
                  {skill.active ? 'HABILITADO' : 'DESACTIVADO'}
                </span>
                <Switch
                  checked={!!skill.active}
                  disabled={togglingId === skill.id}
                  onClick={e => e.stopPropagation()}
                  onCheckedChange={checked => handleToggle(skill.id, checked)}
                  className="scale-75 data-[state=checked]:bg-blue-500"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editingSkill} onOpenChange={open => !open && setEditingSkill(null)}>
        <DialogContent className="max-w-3xl bg-zinc-950 border-white/10 text-white p-0 overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-white/5 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Cpu className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-white uppercase tracking-tight">Propiedades del Nodo de Habilidad</DialogTitle>
                <DialogDescription className="text-xs text-white/40">Editor granular de capacidades cognitivas y herramientas vinculadas.</DialogDescription>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
            {/* Sección General */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-8 bg-blue-500 rounded-full" />
                <span className="text-[10px] font-black tracking-widest text-white/40 uppercase">Información General</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="skill-name" className="text-[10px] uppercase tracking-widest text-white/60">Nombre del Nodo</Label>
                  <Input
                    id="skill-name"
                    value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white font-medium"
                    placeholder="Ej: canvas_dashboard"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="skill-category" className="text-[10px] uppercase tracking-widest text-white/60">Categoría Funcional</Label>
                  <Input
                    id="skill-category"
                    value={editForm.category}
                    onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/70"
                    placeholder="Ej: visualización, análisis..."
                  />
                </div>
              </div>
            </div>

            {/* Configuración Técnica */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-8 bg-blue-500 rounded-full" />
                <span className="text-[10px] font-black tracking-widest text-white/40 uppercase">Capacidades y Activación</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="skill-tools" className="text-[10px] uppercase tracking-widest text-white/60">Herramientas Vinculadas (CSV)</Label>
                  <Input
                    id="skill-tools"
                    value={editForm.tools}
                    onChange={e => setEditForm(p => ({ ...p, tools: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/80 font-mono text-[11px]"
                    placeholder="tool1, tool2, tool3..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="skill-triggers" className="text-[10px] uppercase tracking-widest text-white/60">Frases de Activación / Triggers (CSV)</Label>
                  <Input
                    id="skill-triggers"
                    value={editForm.triggers}
                    onChange={e => setEditForm(p => ({ ...p, triggers: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/80 font-mono text-[11px]"
                    placeholder="mostrar panel, dashboard..."
                  />
                </div>
              </div>
            </div>

            {/* Lógica y Cuerpo */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-8 bg-blue-500 rounded-full" />
                <span className="text-[10px] font-black tracking-widest text-white/40 uppercase">Cuerpo / Lógica del Nodo</span>
              </div>
              <div className="space-y-2">
                <Textarea
                  ref={textareaRef}
                  value={editForm.body}
                  onChange={e => {
                    setEditForm(p => ({ ...p, body: e.target.value }));
                    adjustHeight();
                  }}
                  className="min-h-[160px] resize-none bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/80 text-sm overflow-hidden font-sans leading-relaxed p-4"
                  placeholder="Instrucciones detalladas y lógica de ejecución..."
                />
              </div>
            </div>

            {/* Versión y Meta */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
              <div className="space-y-2">
                <Label htmlFor="skill-version" className="text-[10px] uppercase tracking-widest text-white/60">Versión del Skill</Label>
                <Input
                  id="skill-version"
                  type="number"
                  step="0.1"
                  value={editForm.version}
                  onChange={e => setEditForm(p => ({ ...p, version: Number(e.target.value) }))}
                  className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white w-32"
                />
              </div>
              <div className="flex flex-col justify-center space-y-3">
                <Label className="text-[10px] uppercase tracking-widest text-white/60">Estado del Nodo</Label>
                <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/10 w-fit">
                  <div className={`h-2 w-2 rounded-full ${editForm.active ? 'bg-blue-500 shadow-blue-glow animate-pulse' : 'bg-white/20'}`} />
                  <span className={`text-[10px] font-black tracking-widest ${editForm.active ? 'text-white' : 'text-white/40'}`}>
                    {editForm.active ? 'OPERATIVO / ACTIVO' : 'FUERA DE LÍNEA / INACTIVO'}
                  </span>
                  <Switch
                    checked={editForm.active}
                    onCheckedChange={active => setEditForm(p => ({ ...p, active }))}
                    className="data-[state=checked]:bg-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="p-6 bg-white/5 flex items-center justify-end gap-3 border-t border-white/5 sm:justify-end">
            <Button
              variant="ghost"
              className="text-[10px] font-black tracking-widest hover:bg-white/5 hover:text-white text-white/40 uppercase"
              onClick={() => setEditingSkill(null)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] tracking-widest px-8 rounded-lg shadow-lg shadow-blue-900/20 uppercase"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "PROCESANDO..." : "Sincronizar Propiedades"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
