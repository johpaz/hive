import { User, Save, Loader2, Globe, Clock, Briefcase, Bell, Pencil, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useUserStore } from "@/stores/userStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";

const CRON_CHANNEL_OPTIONS = [
  { value: "auto",     label: "Auto — detectar mejor canal" },
  { value: "webchat",  label: "Web Chat" },
  { value: "telegram", label: "Telegram" },
  { value: "discord",  label: "Discord" },
];

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function UserProfileEditor() {
  const { fetchUser, saveUser, isLoading } = useUserStore();
  const [editing, setEditing] = useState(false);

  const [formData, setFormData] = useState({
    name: "", occupation: "", language: "",
    timezone: "", preferred_cron_channel: "auto", notes: "",
  });

  useEffect(() => {
    fetchUser().then((user: any) => {
      if (user) setFormData({
        name:                   user.name                   || "",
        occupation:             user.occupation             || "",
        language:               user.language               || "",
        timezone:               user.timezone               || "",
        preferred_cron_channel: user.preferred_cron_channel || "auto",
        notes:                  user.notes                  || "",
      });
    }).catch(console.error);
  }, [fetchUser]);

  const update = (field: keyof typeof formData, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    loader.show("Guardando perfil de usuario...");
    try {
      const message = await saveUser(formData);
      Toast.fire({ icon: "success", title: message });
      setEditing(false);
    } catch (err) {
      Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al guardar el perfil" });
    } finally {
      loader.hide();
    }
  };

  return (
    <div className="space-y-4">

      {/* ── Premium profile card ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl shadow-2xl">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-10 -left-10 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-indigo-600/15 rounded-full blur-3xl" />
        </div>

        <div className="relative h-20 bg-gradient-to-r from-blue-600/30 via-indigo-600/20 to-violet-600/10">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_12px,rgba(255,255,255,0.015)_12px,rgba(255,255,255,0.015)_13px)]" />
        </div>

        <div className="relative px-6 pb-6">
          <div className="relative -mt-8 mb-4 w-fit">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30 ring-2 ring-zinc-950 text-white font-bold text-xl tracking-tight">
              {getInitials(formData.name)}
            </div>
            <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-zinc-950 shadow" />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h3 className="text-lg font-bold text-white leading-tight truncate">
                {formData.name || <span className="text-zinc-500 italic text-sm font-normal">Sin nombre</span>}
              </h3>
              {formData.occupation && (
                <p className="text-sm text-zinc-400">{formData.occupation}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {formData.language && (
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
                    <Globe className="h-3 w-3" />{formData.language}
                  </span>
                )}
                {formData.timezone && (
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
                    <Clock className="h-3 w-3" />{formData.timezone}
                  </span>
                )}
                {formData.preferred_cron_channel !== "auto" && (
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
                    <Bell className="h-3 w-3" />{formData.preferred_cron_channel}
                  </span>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(v => !v)}
              className="shrink-0 border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 gap-1.5 h-8 text-xs"
            >
              {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              {editing ? "Cancelar" : "Editar"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Premium edit form ────────────────────────────────────────────── */}
      {editing && (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">

          {/* Subtle glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-blue-600/10 rounded-full blur-3xl" />
          </div>

          {/* Form header */}
          <div className="relative flex items-center gap-3 px-6 pt-5 pb-4 border-b border-white/5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <User className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-white uppercase tracking-wider">Editar perfil</p>
              <p className="text-[10px] text-zinc-500">Datos personales y preferencias</p>
            </div>
          </div>

          <div className="relative p-6 space-y-6">

            {/* Identity section */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Identidad</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                    <User className="h-3 w-3" /> Nombre completo
                  </Label>
                  <Input
                    placeholder="John Doe"
                    value={formData.name}
                    onChange={e => update("name", e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-blue-500/50 h-9 text-sm transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3" /> Ocupación
                  </Label>
                  <Input
                    placeholder="AI Engineer"
                    value={formData.occupation}
                    onChange={e => update("occupation", e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-blue-500/50 h-9 text-sm transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Locale section */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Localización</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                    <Globe className="h-3 w-3" /> Idioma
                  </Label>
                  <Input
                    placeholder="Spanish"
                    value={formData.language}
                    onChange={e => update("language", e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-blue-500/50 h-9 text-sm transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Zona horaria
                  </Label>
                  <Input
                    placeholder="America/Bogota"
                    value={formData.timezone}
                    onChange={e => update("timezone", e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-blue-500/50 h-9 text-sm transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Notifications section */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Notificaciones</p>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                  <Bell className="h-3 w-3" /> Canal preferido para Cron Jobs
                </Label>
                <Select value={formData.preferred_cron_channel} onValueChange={v => update("preferred_cron_channel", v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 focus:border-blue-500/50 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    {CRON_CHANNEL_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-sm focus:bg-blue-500/20 focus:text-blue-400">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes section */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Contexto para el agente</p>
              <Textarea
                placeholder="Describe tu perfil, preferencias de trabajo, estilo de comunicación..."
                value={formData.notes}
                onChange={e => update("notes", e.target.value)}
                className="bg-white/5 border-white/10 focus:border-blue-500/50 text-sm resize-none min-h-[100px] transition-all"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                className="text-zinc-400 hover:bg-white/5 h-9 text-xs"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 gap-2 h-9 text-xs px-6"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
