import { useState, useEffect, useRef, useMemo } from "react";
import { Wand2, Loader2, Info, Sparkles, Cpu, Trash2, Plus, Search, X } from "lucide-react";
import { useSkills } from "@/hooks/useProviders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import { apiClient } from "@/lib/api";
import { SkillCard } from "./SkillCard";
import type { Skill } from "@/types";

const EMPTY_FORM = { name: "", body: "", tools: "", triggers: "", category: "", version: 1, active: true };

interface RuntimeStatus {
  version: string;
  hiveHome: string;
  healthy: boolean;
  skills: {
    total: number;
    active: number;
    required: Array<{ name: string; present: boolean; active: boolean }>;
  };
}

export function SkillsTab() {
  const { skills, isLoading, fetchSkills, toggleSkill, updateSkill } = useSkills();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("TODOS");

  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
  };

  useEffect(() => {
    if (!editingSkill && !isCreating) return;
    const timer = setTimeout(adjustHeight, 0);
    return () => clearTimeout(timer);
  }, [editingSkill, isCreating, editForm.body]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // When the catalog is empty, show whether this is a database problem or an
  // outdated desktop sidecar. The endpoint contains no secrets or skill body.
  useEffect(() => {
    if (skills.length > 0) return;
    let cancelled = false;
    apiClient<RuntimeStatus>("/api/system/runtime", { showError: false })
      .then((status) => { if (!cancelled) setRuntimeStatus(status); })
      .catch(() => { if (!cancelled) setRuntimeStatus(null); });
    return () => { cancelled = true; };
  }, [skills.length]);

  const categories = useMemo<string[]>(() => {
    const cats = new Set<string>(skills.map(s => (s.category || "GENERAL").toUpperCase()));
    return ["TODOS", ...Array.from(cats).sort()];
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return skills.filter(s => {
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        (s.category || "").toLowerCase().includes(q) ||
        (s.body || "").toLowerCase().includes(q);
      const matchesCategory =
        activeCategory === "TODOS" ||
        (s.category || "GENERAL").toUpperCase() === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [skills, searchQuery, activeCategory]);

  const activeCount = skills.filter(s => s.active).length;

  const handleToggle = async (id: string, active: boolean) => {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await toggleSkill(id, active);
      await fetchSkills();
      Toast.fire({ icon: "success", title: active ? "Skill habilitado" : "Skill deshabilitado" });
    } catch {
      Toast.fire({ icon: "error", title: "Error al cambiar estado del skill" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!editingSkill) return;
    setIsDeleting(true);
    try {
      await apiClient(`/api/skills/${editingSkill.id}`, { method: "DELETE", showError: true });
      Toast.fire({ icon: "success", title: "Skill eliminado" });
      fetchSkills();
      setEditingSkill(null);
    } catch {
      Toast.fire({ icon: "error", title: "Error al eliminar skill" });
    } finally {
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleOpenEdit = (skill: Skill) => {
    setIsCreating(false);
    setConfirmingDelete(false);
    setEditingSkill(skill);
    setEditForm({
      name: skill.name,
      body: skill.body || "",
      tools: skill.tools || "",
      triggers: skill.triggers || "",
      category: skill.category || "",
      version: Number(skill.version) || 1,
      active: !!skill.active,
    });
  };

  const handleOpenCreate = () => {
    setEditingSkill(null);
    setConfirmingDelete(false);
    setEditForm(EMPTY_FORM);
    setIsCreating(true);
  };

  const handleCloseModal = () => {
    setEditingSkill(null);
    setIsCreating(false);
    setConfirmingDelete(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    loader.show(isCreating ? "Creando skill..." : "Guardando skill...");
    try {
      if (isCreating) {
        await apiClient("/api/skills", { method: "POST", body: editForm, showError: true });
        Toast.fire({ icon: "success", title: "Skill creado correctamente" });
      } else if (editingSkill) {
        await updateSkill(editingSkill.id, editForm);
        Toast.fire({ icon: "success", title: "Skill actualizado correctamente" });
      }
      fetchSkills();
      handleCloseModal();
    } catch {
      Toast.fire({ icon: "error", title: isCreating ? "Error al crear skill" : "Error al actualizar skill" });
    } finally {
      setIsSaving(false);
      loader.hide();
    }
  };

  const isModalOpen = !!editingSkill || isCreating;

  if (isLoading && skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
          <Sparkles className="h-4 w-4 text-primary absolute -top-1 -right-1 animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground animate-pulse">Cargando habilidades del sistema...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Wand2 className="h-4 w-4 text-blue-400" />
            <h3 className="hive-title-section !text-lg">Habilidades del Sistema</h3>
            <span className="hive-tag bg-blue-500/10 text-blue-400 border-blue-500/20">
              {activeCount} ACTIVAS
            </span>
            <span className="hive-tag bg-white/5 text-white/30 border-white/5">
              {skills.length} TOTAL
            </span>
          </div>
          <p className="hive-subtitle !mt-0 !text-xs">
            Gestiona los módulos cognitivos que otorgan capacidades autónomas a tus agentes.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar habilidad..."
              className="pl-8 pr-8 h-8 w-52 bg-white/5 border-white/10 text-white text-xs placeholder:text-white/20 focus-visible:ring-blue-500/30"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/60 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            onClick={handleOpenCreate}
            className="h-8 bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] tracking-widest uppercase px-4 shadow-btn-primary"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nueva Habilidad
          </Button>
        </div>
      </div>

      {/* ── Category filters ── */}
      {skills.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {categories.map(cat => {
            const count = cat === "TODOS"
              ? skills.length
              : skills.filter(s => (s.category || "GENERAL").toUpperCase() === cat).length;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition-all duration-200 ${
                  isActive
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-400 shadow-[0_0_8px_hsl(217_91%_60%/0.15)]"
                    : "bg-white/5 border-white/10 text-white/30 hover:text-white/60 hover:border-white/20"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-blue-400" : "bg-white/20"}`} />
                {cat}
                <span className={`text-[8px] ${isActive ? "text-blue-300/70" : "text-white/20"}`}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Grid or empty states ── */}
      {skills.length === 0 ? (
        <div className="hive-card border-dashed border-white/10 bg-white/[0.02]">
          <div className="hive-card-body flex flex-col items-center justify-center py-16 px-4">
            <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
              <Wand2 className="h-8 w-8 text-white/20" />
            </div>
            <p className="hive-title-section text-center mb-2">No se detectan habilidades</p>
            <p className="text-xs text-white/40 mb-8 max-w-[300px] mx-auto leading-relaxed text-center">
              El repositorio de habilidades está vacío. Revisa el estado del gateway antes de crear una habilidad.
            </p>
            {runtimeStatus && (
              <div className="mb-8 max-w-xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left text-[11px] text-amber-100/70">
                <p className="font-semibold text-amber-200">Diagnóstico del runtime {runtimeStatus.version}</p>
                <p className="mt-1 font-mono break-all">HIVE_HOME: {runtimeStatus.hiveHome}</p>
                <p className="mt-1">
                  {runtimeStatus.skills.total} skills detectadas, {runtimeStatus.skills.active} activas.
                  {!runtimeStatus.healthy && " Faltan dependencias del catálogo A2UI."}
                </p>
                <p className="mt-1">
                  Requeridas ausentes/inactivas: {runtimeStatus.skills.required.reduce<string[]>((missing, skill) => {
                    if (!skill.present || !skill.active) missing.push(skill.name);
                    return missing;
                  }, []).join(", ") || "ninguna"}
                </p>
              </div>
            )}
            <Button
              onClick={handleOpenCreate}
              className="hive-btn hive-btn--primary px-8"
            >
              <Plus className="h-4 w-4 mr-2" />
              Crear Habilidad
            </Button>
          </div>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
          <Search className="h-8 w-8 text-white/10" />
          <p className="text-sm font-bold text-white/30 uppercase tracking-widest">Sin resultados</p>
          <p className="text-xs text-white/20">
            No hay habilidades que coincidan con &ldquo;{searchQuery}&rdquo;
            {activeCategory !== "TODOS" && ` en la categoría ${activeCategory}`}.
          </p>
          <button
            onClick={() => { setSearchQuery(""); setActiveCategory("TODOS"); }}
            className="text-[10px] font-black uppercase tracking-widest text-blue-400/60 hover:text-blue-400 transition-colors mt-2"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredSkills.map(skill => (
            <div key={skill.id} className="relative">
              <SkillCard skill={skill} onClick={() => handleOpenEdit(skill)} />
              <div className="absolute top-5 right-5 z-20 pointer-events-auto flex items-center gap-2">
                <span className={`text-[9px] font-black tracking-widest ${skill.active ? "text-blue-400" : "text-white/20"}`}>
                  {skill.active ? "ON" : "OFF"}
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

      {/* ── Modal edición / creación ── */}
      <Dialog open={isModalOpen} onOpenChange={open => { if (!open) handleCloseModal(); }}>
        <DialogContent className="max-w-3xl bg-zinc-950 border-white/10 text-white p-0 overflow-hidden shadow-2xl">

          {/* Modal header */}
          <div className="p-6 border-b border-white/5 bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center border ${
                  isCreating
                    ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                    : "bg-white/5 border-white/10 text-white/60"
                }`}>
                  {isCreating ? <Plus className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
                </div>
                <div>
                  <DialogTitle className="text-sm font-black text-white uppercase tracking-tight">
                    {isCreating ? "Nueva Habilidad" : "Propiedades del Nodo"}
                  </DialogTitle>
                  <DialogDescription className="text-[10px] text-white/30">
                    {isCreating
                      ? "Define las propiedades del nuevo módulo cognitivo."
                      : "Editor granular de capacidades cognitivas y herramientas vinculadas."}
                  </DialogDescription>
                </div>
              </div>
              {!isCreating && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={isDeleting || confirmingDelete}
                  className="text-zinc-600 hover:text-red-400 hover:bg-red-400/10 h-8 w-8 transition-colors shrink-0"
                  title="Eliminar Skill"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Delete confirmation */}
          {confirmingDelete && (
            <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-xs text-red-400 font-medium mb-3">
                ¿Eliminar <span className="font-black">{editingSkill?.name}</span>? Esta acción no se puede deshacer.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                  className="h-7 px-3 text-[10px] font-black uppercase tracking-wider text-zinc-400 hover:text-white"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="h-7 px-3 text-[10px] font-black uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white"
                >
                  {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sí, eliminar"}
                </Button>
              </div>
            </div>
          )}

          {/* Modal body */}
          <div className="p-6 space-y-7 max-h-[65vh] overflow-y-auto custom-scrollbar">

            {/* General */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[9px] font-black tracking-widest text-white/20 uppercase px-2">Información General</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="skill-name" className="text-[10px] uppercase tracking-widest text-white/40">Nombre del Nodo</Label>
                  <Input
                    id="skill-name"
                    value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white font-medium"
                    placeholder="Ej: a2ui_dashboard"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="skill-category" className="text-[10px] uppercase tracking-widest text-white/40">Categoría Funcional</Label>
                  <Input
                    id="skill-category"
                    value={editForm.category}
                    onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/70"
                    placeholder="Ej: visualización, análisis..."
                  />
                </div>
              </div>
            </section>

            {/* Capacidades */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[9px] font-black tracking-widest text-white/20 uppercase px-2">Capacidades y Activación</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="skill-tools" className="text-[10px] uppercase tracking-widest text-white/40">
                    <span className="text-cyan-400/60">Herramientas Vinculadas</span> (CSV)
                  </Label>
                  <Input
                    id="skill-tools"
                    value={editForm.tools}
                    onChange={e => setEditForm(p => ({ ...p, tools: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-cyan-500/30 text-white/80 font-mono text-[11px]"
                    placeholder="tool1, tool2, tool3..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="skill-triggers" className="text-[10px] uppercase tracking-widest text-white/40">
                    <span className="text-purple-400/60">Triggers</span> de Activación (CSV)
                  </Label>
                  <Input
                    id="skill-triggers"
                    value={editForm.triggers}
                    onChange={e => setEditForm(p => ({ ...p, triggers: e.target.value }))}
                    className="bg-white/5 border-white/10 focus-visible:ring-purple-500/30 text-white/80 font-mono text-[11px]"
                    placeholder="mostrar panel, dashboard..."
                  />
                </div>
              </div>
            </section>

            {/* Cuerpo */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[9px] font-black tracking-widest text-white/20 uppercase px-2">Cuerpo / Lógica del Nodo</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <Textarea
                ref={textareaRef}
                value={editForm.body}
                onChange={e => { setEditForm(p => ({ ...p, body: e.target.value })); adjustHeight(); }}
                className="min-h-[140px] resize-none bg-white/5 border-white/10 focus-visible:ring-blue-500/30 text-white/80 text-sm overflow-hidden font-sans leading-relaxed p-4"
                placeholder="Instrucciones detalladas y lógica de ejecución del módulo cognitivo..."
              />
            </section>

            {/* Versión y estado */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
              <div className="space-y-1.5">
                <Label htmlFor="skill-version" className="text-[10px] uppercase tracking-widest text-white/40">
                  <span className="text-amber-400/60">Versión</span> del Skill
                </Label>
                <Input
                  id="skill-version"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={editForm.version}
                  onChange={e => setEditForm(p => ({ ...p, version: Number(e.target.value) }))}
                  className="bg-white/5 border-white/10 focus-visible:ring-amber-500/20 text-white w-32"
                />
              </div>
              <div className="flex flex-col justify-center space-y-2">
                <Label className="text-[10px] uppercase tracking-widest text-white/40">Estado del Nodo</Label>
                <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10 w-fit">
                  <div className={`h-2 w-2 rounded-full transition-colors ${editForm.active ? "bg-blue-500 shadow-[0_0_6px_hsl(217_91%_60%/0.8)] animate-pulse" : "bg-white/20"}`} />
                  <span className={`text-[9px] font-black tracking-widest ${editForm.active ? "text-white" : "text-white/30"}`}>
                    {editForm.active ? "OPERATIVO / ACTIVO" : "FUERA DE LÍNEA / INACTIVO"}
                  </span>
                  <Switch
                    checked={editForm.active}
                    onCheckedChange={active => setEditForm(p => ({ ...p, active }))}
                    className="data-[state=checked]:bg-blue-500"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Footer */}
          <DialogFooter className="p-5 bg-white/[0.02] flex items-center justify-between gap-3 border-t border-white/5 sm:justify-between">
            <div className="flex items-center gap-1.5 text-[9px] font-black tracking-widest text-white/15 uppercase">
              <Info className="h-3 w-3" />
              {isCreating ? "Nueva habilidad" : `ID: ${editingSkill?.id?.substring(0, 8)}...`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="text-[10px] font-black tracking-widest hover:bg-white/5 hover:text-white text-white/30 uppercase"
                onClick={handleCloseModal}
              >
                Cancelar
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] tracking-widest px-6 rounded-lg shadow-btn-primary uppercase"
                onClick={handleSave}
                disabled={isSaving || !editForm.name.trim()}
              >
                {isSaving
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />PROCESANDO...</>
                  : isCreating ? "Crear Habilidad" : "Sincronizar Propiedades"
                }
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
