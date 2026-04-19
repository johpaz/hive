import { User, Save, Loader2, Globe, Clock, Briefcase, Bell, Pencil, X, Check, Hexagon } from "lucide-react";
import { useState, useEffect } from "react";
import { useUserStore } from "@/stores/userStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";

/* ── Honeycomb SVG pattern (inline, very subtle) ──────────────────────── */
const HoneycombPattern = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ opacity: 0.04 }}
  >
    <defs>
      <pattern id="honeycomb" x="0" y="0" width="28" height="32" patternUnits="userSpaceOnUse">
        <polygon
          points="14,2 26,9 26,23 14,30 2,23 2,9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <polygon
          points="0,16 -12,23 -12,9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <polygon
          points="28,16 40,23 40,9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#honeycomb)" />
  </svg>
);

/* ── Hexagonal avatar clip-path ───────────────────────────────────────── */
const HexAvatar = ({ initials }: { initials: string }) => (
  <div className="relative w-16 h-16 flex-shrink-0">
    <div
      className="w-full h-full flex items-center justify-center text-white font-black text-lg tracking-tight select-none"
      style={{
        clipPath: "polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)",
        background: "linear-gradient(135deg, hsl(var(--hive-amber)) 0%, hsl(var(--hive-orange)) 100%)",
        boxShadow: "0 0 20px hsl(var(--hive-amber) / 0.35)",
      }}
    >
      {initials}
    </div>
    {/* Online badge */}
    <span
      className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 animate-pulse"
      style={{
        background: "hsl(var(--hive-green))",
        borderColor: "hsl(var(--background))",
        boxShadow: "0 0 6px hsl(var(--hive-green) / 0.6)",
      }}
    />
  </div>
);

/* ── Section label with hex bullet ───────────────────────────────────── */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <Hexagon
      className="h-3 w-3 flex-shrink-0"
      style={{ color: "hsl(var(--hive-amber))", fill: "hsl(var(--hive-amber) / 0.2)" }}
    />
    <p className="hive-label" style={{ color: "hsl(var(--hive-amber) / 0.8)" }}>{children}</p>
  </div>
);

/* ── Constants ────────────────────────────────────────────────────────── */
const CRON_CHANNEL_OPTIONS = [
  { value: "auto",     label: "Auto — detectar mejor canal" },
  { value: "webchat",  label: "Web Chat" },
  { value: "telegram", label: "Telegram" },
  { value: "discord",  label: "Discord" },
];

type FormData = {
  name: string;
  occupation: string;
  language: string;
  timezone: string;
  preferred_cron_channel: string;
  notes: string;
};

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* ── Component ────────────────────────────────────────────────────────── */
export function UserProfileEditor() {
  const { fetchUser, saveUser, isLoading } = useUserStore();
  const [editing, setEditing] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    name: "", occupation: "", language: "",
    timezone: "", preferred_cron_channel: "auto", notes: "",
  });
  const [saved, setSaved] = useState<FormData | null>(null);

  useEffect(() => {
    fetchUser().then((user: any) => {
      if (user) {
        const data: FormData = {
          name:                   user.name                   || "",
          occupation:             user.occupation             || "",
          language:               user.language               || "",
          timezone:               user.timezone               || "",
          preferred_cron_channel: user.preferred_cron_channel || "auto",
          notes:                  user.notes                  || "",
        };
        setFormData(data);
        setSaved(data);
      }
    }).catch(console.error);
  }, [fetchUser]);

  const update = (field: keyof FormData, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const handleCancel = () => {
    if (saved) setFormData(saved);
    setEditing(false);
  };

  const handleSave = async () => {
    loader.show("Guardando perfil...");
    try {
      const message = await saveUser(formData);
      setSaved(formData);
      Toast.fire({ icon: "success", title: message });
      setEditing(false);
    } catch (err) {
      Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al guardar el perfil" });
    } finally {
      loader.hide();
    }
  };

  return (
    <div className="space-y-3">

      {/* ══════════════════════════════════════════
          PROFILE CARD
      ══════════════════════════════════════════ */}
      <div
        className="relative overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300"
        style={{
          background: "hsl(var(--hive-surface) / 0.6)",
          borderColor: "hsl(var(--hive-border-base))",
          boxShadow: "0 0 40px hsl(var(--hive-amber) / 0.06)",
        }}
      >
        {/* ── Cover ── */}
        <div className="relative h-20 overflow-hidden text-white">
          <HoneycombPattern />
          {/* Amber gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(120deg, hsl(var(--hive-amber)/0.3) 0%, hsl(var(--hive-orange)/0.15) 40%, transparent 75%)",
            }}
          />
          {/* Ambient amber glow */}
          <div
            className="absolute -top-8 -left-8 w-40 h-40 rounded-full blur-3xl pointer-events-none"
            style={{ background: "hsl(var(--hive-amber) / 0.15)" }}
          />
          {/* HIVE OS label */}
          <div className="absolute top-3 right-4 flex items-center gap-1.5">
            <span
              className="text-[9px] font-black tracking-[0.25em] uppercase"
              style={{ color: "hsl(var(--hive-amber) / 0.6)" }}
            >
              HIVE OS
            </span>
            <div
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{
                background: "hsl(var(--hive-amber))",
                boxShadow: "0 0 6px hsl(var(--hive-amber))",
              }}
            />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 pb-5">
          {/* Avatar + actions row */}
          <div className="flex items-end justify-between -mt-8 mb-4">
            <HexAvatar initials={getInitials(formData.name)} />
            <button
              onClick={() => setEditing(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 mb-1"
              style={editing
                ? {
                    background: "hsl(var(--hive-red-dark) / 0.15)",
                    border: "1px solid hsl(var(--hive-red) / 0.3)",
                    color: "hsl(var(--hive-red))",
                  }
                : {
                    background: "hsl(var(--hive-glass))",
                    border: "1px solid hsl(var(--hive-border-base))",
                    color: "hsl(var(--hive-text-muted))",
                  }
              }
            >
              {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              {editing ? "Cancelar" : "Editar"}
            </button>
          </div>

          {/* Name + occupation */}
          <div className="space-y-0.5 mb-3">
            <h3 className="text-base font-bold text-white leading-tight">
              {formData.name || (
                <span className="text-sm font-normal italic" style={{ color: "hsl(var(--hive-text-placeholder))" }}>
                  Sin nombre configurado
                </span>
              )}
            </h3>
            {formData.occupation && (
              <p className="text-xs" style={{ color: "hsl(var(--hive-text-muted))" }}>
                {formData.occupation}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {formData.language && (
              <span
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border"
                style={{
                  background: "hsl(var(--hive-blue) / 0.08)",
                  borderColor: "hsl(var(--hive-blue) / 0.2)",
                  color: "hsl(var(--hive-blue))",
                }}
              >
                <Globe className="h-2.5 w-2.5" />
                {formData.language}
              </span>
            )}
            {formData.timezone && (
              <span
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border"
                style={{
                  background: "hsl(var(--hive-blue) / 0.08)",
                  borderColor: "hsl(var(--hive-blue) / 0.2)",
                  color: "hsl(var(--hive-blue))",
                }}
              >
                <Clock className="h-2.5 w-2.5" />
                {formData.timezone}
              </span>
            )}
            {formData.preferred_cron_channel !== "auto" && (
              <span
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border"
                style={{
                  background: "hsl(var(--hive-purple) / 0.1)",
                  borderColor: "hsl(var(--hive-purple) / 0.25)",
                  color: "hsl(var(--hive-purple))",
                }}
              >
                <Bell className="h-2.5 w-2.5" />
                {formData.preferred_cron_channel}
              </span>
            )}
          </div>
        </div>

        {/* Bottom amber strip */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background: "linear-gradient(90deg, transparent, hsl(var(--hive-amber) / 0.3), transparent)",
          }}
        />
      </div>

      {/* ══════════════════════════════════════════
          EDIT FORM CARD
      ══════════════════════════════════════════ */}
      {editing && (
        <div
          className="relative overflow-hidden rounded-2xl border backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            background: "hsl(var(--hive-surface) / 0.7)",
            borderColor: "hsl(var(--hive-border-base))",
          }}
        >
          {/* Ambient glow blobs */}
          <div
            className="absolute -top-12 -left-12 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
            style={{ background: "hsl(var(--hive-amber) / 0.07)" }}
          />
          <div
            className="absolute -bottom-12 -right-12 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
            style={{ background: "hsl(var(--hive-blue) / 0.08)" }}
          />

          {/* Form header */}
          <div
            className="relative flex items-center gap-3 px-5 pt-4 pb-3.5 border-b"
            style={{ borderColor: "hsl(var(--hive-border-subtle))" }}
          >
            <div
              className="p-2 rounded-lg border"
              style={{
                background: "hsl(var(--hive-amber) / 0.1)",
                borderColor: "hsl(var(--hive-amber) / 0.2)",
                color: "hsl(var(--hive-amber))",
              }}
            >
              <User className="h-3.5 w-3.5" />
            </div>
            <div>
              <p
                className="text-[11px] font-black uppercase tracking-[0.2em]"
                style={{ color: "hsl(var(--hive-amber))" }}
              >
                Editar Perfil
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--hive-text-placeholder))" }}>
                Datos personales y preferencias del agente
              </p>
            </div>
          </div>

          <div className="relative p-5 space-y-5">

            {/* IDENTIDAD */}
            <div className="space-y-2.5">
              <SectionLabel>Identidad</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--hive-text-muted))" }}>
                    <User className="h-3 w-3 opacity-60" /> Nombre completo
                  </label>
                  <Input
                    placeholder="John Doe"
                    value={formData.name}
                    onChange={e => update("name", e.target.value)}
                    className="hive-input h-9 text-sm rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--hive-text-muted))" }}>
                    <Briefcase className="h-3 w-3 opacity-60" /> Ocupación
                  </label>
                  <Input
                    placeholder="AI Engineer"
                    value={formData.occupation}
                    onChange={e => update("occupation", e.target.value)}
                    className="hive-input h-9 text-sm rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px" style={{ background: "linear-gradient(90deg, transparent, hsl(var(--hive-amber) / 0.15), transparent)" }} />

            {/* LOCALIZACIÓN */}
            <div className="space-y-2.5">
              <SectionLabel>Localización</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--hive-text-muted))" }}>
                    <Globe className="h-3 w-3 opacity-60" /> Idioma
                  </label>
                  <Input
                    placeholder="Spanish"
                    value={formData.language}
                    onChange={e => update("language", e.target.value)}
                    className="hive-input h-9 text-sm rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--hive-text-muted))" }}>
                    <Clock className="h-3 w-3 opacity-60" /> Zona horaria
                  </label>
                  <Input
                    placeholder="America/Bogota"
                    value={formData.timezone}
                    onChange={e => update("timezone", e.target.value)}
                    className="hive-input h-9 text-sm rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px" style={{ background: "linear-gradient(90deg, transparent, hsl(var(--hive-amber) / 0.15), transparent)" }} />

            {/* NOTIFICACIONES */}
            <div className="space-y-2.5">
              <SectionLabel>Notificaciones</SectionLabel>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--hive-text-muted))" }}>
                  <Bell className="h-3 w-3 opacity-60" /> Canal preferido para Cron Jobs
                </label>
                <Select value={formData.preferred_cron_channel} onValueChange={v => update("preferred_cron_channel", v)}>
                  <SelectTrigger className="hive-select-trigger h-9 text-sm rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="hive-select-content">
                    {CRON_CHANNEL_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="hive-select-item text-sm">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px" style={{ background: "linear-gradient(90deg, transparent, hsl(var(--hive-amber) / 0.15), transparent)" }} />

            {/* CONTEXTO AGENTE */}
            <div className="space-y-2.5">
              <SectionLabel>Contexto para el agente</SectionLabel>
              <Textarea
                placeholder="Describe tu perfil, preferencias de trabajo, estilo de comunicación..."
                value={formData.notes}
                onChange={e => update("notes", e.target.value)}
                className="hive-textarea text-sm rounded-lg min-h-[88px]"
              />
            </div>

            {/* Actions */}
            <div
              className="flex items-center justify-end gap-2 pt-3 border-t"
              style={{ borderColor: "hsl(var(--hive-border-subtle))" }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="h-9 text-xs px-4 rounded-lg border transition-all"
                style={{
                  background: "transparent",
                  borderColor: "hsl(var(--hive-border-base))",
                  color: "hsl(var(--hive-text-muted))",
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={isLoading}
                size="sm"
                className="h-9 text-xs px-5 rounded-lg gap-2 font-bold text-white transition-all"
                style={{
                  background: "hsl(var(--hive-blue-dark))",
                  boxShadow: "var(--shadow-btn-primary)",
                }}
              >
                {isLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />
                }
                Guardar cambios
              </Button>
            </div>

          </div>

          {/* Bottom blue strip */}
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{
              background: "linear-gradient(90deg, transparent, hsl(var(--hive-blue) / 0.3), transparent)",
            }}
          />
        </div>
      )}

    </div>
  );
}
