import {
  User, Loader2, Globe, Clock, Briefcase, Mail,
  Bell, Pencil, X, Check, Hexagon, Bot, Zap,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useUserStore } from "@/stores/userStore";
import { useNotesAndCronsStore } from "@/stores/useNotesAndCronsStore";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import { SecurityPanel } from "@/components/SecurityPanel";

/* ─── Honeycomb SVG pattern ──────────────────────────────────────────── */
const HoneycombBg = () => (
  <svg
    aria-hidden
    className="absolute inset-0 w-full h-full pointer-events-none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ opacity: 0.05, color: "hsl(var(--hive-amber))" }}
  >
    <defs>
      <pattern id="hc-profile" x="0" y="0" width="30" height="34" patternUnits="userSpaceOnUse">
        <polygon
          points="15,2 28,9.5 28,24.5 15,32 2,24.5 2,9.5"
          fill="none" stroke="currentColor" strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#hc-profile)" />
  </svg>
);

/* ─── Hexagonal avatar ───────────────────────────────────────────────── */
const HexAvatar = ({ initials, size = "lg" }: { initials: string; size?: "sm" | "lg" }) => {
  const dim = size === "sm" ? "w-14 h-14" : "w-20 h-20";
  const text = size === "sm" ? "text-lg" : "text-2xl";
  return (
    <div className={`relative ${dim} flex-shrink-0`}>
      <div
        className={`w-full h-full flex items-center justify-center text-white font-black ${text} tracking-tight select-none`}
        style={{
          clipPath: "polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)",
          background: "linear-gradient(135deg, hsl(var(--hive-amber)) 0%, hsl(var(--hive-orange)) 100%)",
          boxShadow: "0 0 24px hsl(var(--hive-amber) / 0.4)",
        }}
      >
        {initials}
      </div>
      <span
        className="absolute bottom-0.5 right-1 h-3.5 w-3.5 rounded-full border-2 animate-pulse"
        style={{
          background: "hsl(var(--hive-green))",
          borderColor: "hsl(var(--background))",
          boxShadow: "0 0 8px hsl(var(--hive-green) / 0.6)",
        }}
      />
    </div>
  );
};

/* ─── Section label with hex bullet ─────────────────────────────────── */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 mb-2.5">
    <Hexagon
      className="h-3 w-3 flex-shrink-0"
      style={{ color: "hsl(var(--hive-amber))", fill: "hsl(var(--hive-amber) / 0.2)" }}
    />
    <p className="text-[10px] font-black uppercase tracking-[0.18em]"
      style={{ color: "hsl(var(--hive-amber) / 0.85)" }}>
      {children}
    </p>
  </div>
);

/* ─── Amber divider ──────────────────────────────────────────────────── */
const Divider = () => (
  <div className="h-px"
    style={{ background: "linear-gradient(90deg,transparent,hsl(var(--hive-amber)/0.18),transparent)" }} />
);

/* ─── Tag pill ───────────────────────────────────────────────────────── */
const Tag = ({ icon: Icon, label, colorVar }: {
  icon: React.ElementType; label: string; colorVar: string;
}) => (
  <span
    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
    style={{
      background: `hsl(var(${colorVar}) / 0.08)`,
      borderColor: `hsl(var(${colorVar}) / 0.2)`,
      color: `hsl(var(${colorVar}))`,
    }}
  >
    <Icon className="h-2.5 w-2.5 flex-shrink-0" />{label}
  </span>
);

/* ─── Field wrapper ──────────────────────────────────────────────────── */
const FieldWrap = ({
  label, icon: Icon, editing, children,
}: {
  label: string; icon: React.ElementType; editing: boolean; children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors"
      style={{ color: editing ? "hsl(var(--hive-text-muted))" : "hsl(var(--hive-text-placeholder))" }}
    >
      <Icon className="h-3 w-3 opacity-60" />{label}
    </label>
    {children}
  </div>
);

type FormData = {
  name: string; email: string; occupation: string; language: string;
  timezone: string; preferred_cron_channel: string; notes: string;
};

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* ════════════════════════════════════════════════════════════════════════
   COMPONENT
════════════════════════════════════════════════════════════════════════ */
export function UserProfileEditor() {
  const { fetchUser, saveUser, isLoading } = useUserStore();
  const { cronChannels, fetchCronChannels } = useNotesAndCronsStore();
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: "", email: "", occupation: "", language: "",
    timezone: "", preferred_cron_channel: "auto", notes: "",
  });
  const [saved, setSaved] = useState<FormData | null>(null);

  useEffect(() => {
    fetchUser().then((user: any) => {
      if (!user) return;
      const data: FormData = {
        name:                   user.name                   || "",
        email:                  user.email                  || "",
        occupation:             user.occupation             || "",
        language:               user.language               || "",
        timezone:               user.timezone               || "",
        preferred_cron_channel: user.preferred_cron_channel || "auto",
        notes:                  user.notes                  || "",
      };
      setFormData(data); setSaved(data);
    }).catch(console.error);
    fetchCronChannels();
  }, [fetchUser, fetchCronChannels]);

  const update = (f: keyof FormData, v: string) =>
    setFormData(p => ({ ...p, [f]: v }));

  const handleCancel = () => { if (saved) setFormData(saved); setEditing(false); };

  const handleSave = async () => {
    const email = formData.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Toast.fire({ icon: "error", title: "Ingresa un correo válido" });
      return;
    }
    loader.show("Guardando perfil...");
    try {
      const normalizedData = { ...formData, email };
      const msg = await saveUser(normalizedData);
      setFormData(normalizedData);
      setSaved(normalizedData);
      Toast.fire({ icon: "success", title: msg });
      setEditing(false);
    } catch (err) {
      Toast.fire({ icon: "error", title: err instanceof Error ? err.message : "Error al guardar" });
    } finally { loader.hide(); }
  };

  const activeChannels = cronChannels.filter(c => c.active);
  const channelLabel = formData.preferred_cron_channel === "auto"
    ? "Auto — detectar mejor canal"
    : activeChannels.find(o => o.id === formData.preferred_cron_channel)?.type ?? formData.preferred_cron_channel;
  const initials = getInitials(formData.name);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border flex flex-col lg:flex-row"
      style={{
        background: "hsl(var(--hive-surface)/0.7)",
        borderColor: "hsl(var(--hive-border-base))",
        backdropFilter: "blur(16px)",
        boxShadow: "0 0 60px hsl(var(--hive-amber)/0.05)",
      }}
    >

      {/* ══════════════════════════════════════
          LEFT PANEL — Profile identity
      ══════════════════════════════════════ */}
      <div
        className="relative overflow-hidden flex-shrink-0 lg:w-[40%] lg:flex-col lg:items-center lg:text-center

                   /* mobile: horizontal compact row */
                   flex flex-row items-center gap-4 p-4
                   /* tablet: slightly more padding */
                   sm:p-5
                   /* desktop: vertical centered column */
                   lg:flex-col lg:items-center lg:text-center lg:gap-4 lg:p-6"
        style={{ background: "hsl(220 15% 10% / 0.85)" }}
      >
        {/* Honeycomb texture (desktop only via opacity) */}
        <HoneycombBg />

        {/* Amber ambient glow */}
        <div
          className="absolute -top-16 -left-16 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
          style={{ background: "hsl(var(--hive-amber)/0.1)" }}
        />

        {/* Separator: bottom border on mobile/tablet, right border on desktop */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px lg:hidden"
          style={{ background: "linear-gradient(90deg,transparent,hsl(var(--hive-amber)/0.3),transparent)" }}
        />
        <div
          className="absolute top-0 right-0 bottom-0 w-px hidden lg:block"
          style={{ background: "linear-gradient(to bottom,transparent,hsl(var(--hive-amber)/0.25),transparent)" }}
        />

        {/* ── HIVE OS badge (desktop only) ── */}
        <div className="relative w-full hidden lg:flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: "hsl(var(--hive-amber))", boxShadow: "0 0 6px hsl(var(--hive-amber))" }} />
            <span className="text-[9px] font-black tracking-[0.25em] uppercase"
              style={{ color: "hsl(var(--hive-amber)/0.7)" }}>HIVE OS</span>
          </div>
          <span className="text-[8px] font-mono uppercase tracking-widest"
            style={{ color: "hsl(var(--hive-text-placeholder))" }}>v1.0</span>
        </div>

        {/* ── Avatar ── */}
        {/* sm on mobile, lg on desktop */}
        <div className="relative flex-shrink-0 lg:mx-auto">
          <div className="block lg:hidden">
            <HexAvatar initials={initials} size="sm" />
          </div>
          <div className="hidden lg:block">
            <HexAvatar initials={initials} size="lg" />
          </div>
        </div>

        {/* ── Name + occupation + tags ── */}
        <div className="relative flex-1 lg:flex-none lg:w-full space-y-1 lg:text-center">
          <h3 className="text-sm sm:text-base font-bold text-white leading-tight">
            {formData.name || (
              <span className="text-sm font-normal italic"
                style={{ color: "hsl(var(--hive-text-placeholder))" }}>Sin nombre</span>
            )}
          </h3>
          {formData.occupation && (
            <p className="text-xs" style={{ color: "hsl(var(--hive-text-muted))" }}>
              {formData.occupation}
            </p>
          )}
          {/* Tags — wrap on all sizes */}
          <div className="flex flex-wrap gap-1 lg:justify-center pt-0.5">
            {formData.language && (
              <Tag icon={Globe} label={formData.language} colorVar="--hive-blue" />
            )}
            {formData.timezone && (
              <Tag icon={Clock} label={formData.timezone} colorVar="--hive-blue" />
            )}
            {formData.preferred_cron_channel !== "auto" && (
              <Tag icon={Bell} label={formData.preferred_cron_channel} colorVar="--hive-purple" />
            )}
          </div>
        </div>

        {/* ── Stats grid (hidden on mobile, 2-col on tablet, list on desktop) ── */}
        <div className="relative hidden sm:grid sm:grid-cols-2 lg:grid-cols-1 lg:w-full gap-x-4 gap-y-2
                        sm:mt-0 lg:mt-auto lg:pt-4 lg:border-t"
          style={{ borderColor: "hsl(var(--hive-border-subtle))" }}
        >
          {[
            { icon: Bot,   label: "Agente", value: "Activo",                          colorVar: "--hive-green" },
            { icon: Globe, label: "Idioma", value: formData.language  || "—",         colorVar: "--hive-blue" },
            { icon: Clock, label: "Zona",   value: formData.timezone  || "—",         colorVar: "--hive-blue" },
            { icon: Zap,   label: "Canal",  value: channelLabel.split("—")[0].trim(), colorVar: "--hive-amber" },
          ].map(({ icon: Icon, label, value, colorVar }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3 w-3 flex-shrink-0" style={{ color: `hsl(var(${colorVar}))` }} />
                <span className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "hsl(var(--hive-text-placeholder))" }}>
                  {label}
                </span>
              </div>
              <span className="text-[10px] font-semibold truncate max-w-[90px] text-right"
                style={{ color: "hsl(var(--hive-surface-foreground)/0.7)" }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════
          RIGHT PANEL — Form (always visible)
      ══════════════════════════════════════ */}
      <div className="relative flex-1 flex flex-col overflow-hidden">

        {/* Blue ambient glow */}
        <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full blur-[80px] pointer-events-none"
          style={{ background: "hsl(var(--hive-blue)/0.07)" }} />

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-5 pt-4 pb-3 border-b"
          style={{ borderColor: "hsl(var(--hive-border-subtle))" }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg border flex-shrink-0"
              style={{
                background: "hsl(var(--hive-amber)/0.1)",
                borderColor: "hsl(var(--hive-amber)/0.2)",
                color: "hsl(var(--hive-amber))",
              }}>
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] truncate"
                style={{ color: "hsl(var(--hive-amber))" }}>
                Perfil de usuario
              </p>
              <p className="text-[9px] mt-0.5 hidden sm:block"
                style={{ color: "hsl(var(--hive-text-placeholder))" }}>
                Configuración personal y preferencias del agente
              </p>
            </div>
          </div>

          {/* Edit / Cancel */}
          <button
            onClick={() => editing ? handleCancel() : setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 flex-shrink-0 ml-2"
            style={editing
              ? { background: "hsl(var(--hive-red-dark)/0.15)", border: "1px solid hsl(var(--hive-red)/0.3)", color: "hsl(var(--hive-red))" }
              : { background: "hsl(var(--hive-glass))", border: "1px solid hsl(var(--hive-border-base))", color: "hsl(var(--hive-text-muted))" }
            }
          >
            {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
            <span className="hidden sm:inline">{editing ? "Cancelar" : "Editar"}</span>
          </button>
        </div>

        {/* ── Form body ── */}
        <div className="relative flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

          {/* IDENTIDAD */}
          <section>
            <SectionLabel>Identidad</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <FieldWrap label="Nombre completo" icon={User} editing={editing}>
                <Input placeholder="John Doe" value={formData.name} disabled={!editing}
                  onChange={e => update("name", e.target.value)}
                  className="hive-input h-9 text-sm rounded-lg disabled:opacity-50 disabled:cursor-default" />
              </FieldWrap>
              <FieldWrap label="Ocupación" icon={Briefcase} editing={editing}>
                <Input placeholder="AI Engineer" value={formData.occupation} disabled={!editing}
                  onChange={e => update("occupation", e.target.value)}
                  className="hive-input h-9 text-sm rounded-lg disabled:opacity-50 disabled:cursor-default" />
              </FieldWrap>
              <div className="sm:col-span-2">
                <FieldWrap label="Correo propio" icon={Mail} editing={editing}>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="tu@correo.com"
                    maxLength={254}
                    required
                    value={formData.email}
                    disabled={!editing}
                    onChange={e => update("email", e.target.value)}
                    className="hive-input h-9 text-sm rounded-lg disabled:opacity-50 disabled:cursor-default"
                  />
                </FieldWrap>
                <p className="mt-1.5 text-[10px]" style={{ color: "hsl(var(--hive-text-placeholder))" }}>
                  El coordinador lo usa como destinatario cuando dices «envíame».
                </p>
              </div>
            </div>
          </section>

          <Divider />

          {/* ACCESO */}
          <section>
            <SectionLabel>Acceso y seguridad</SectionLabel>
            <SecurityPanel email={formData.email} profileEditing={editing} />
          </section>

          <Divider />

          {/* LOCALIZACIÓN */}
          <section>
            <SectionLabel>Localización</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <FieldWrap label="Idioma" icon={Globe} editing={editing}>
                <Input placeholder="Spanish" value={formData.language} disabled={!editing}
                  onChange={e => update("language", e.target.value)}
                  className="hive-input h-9 text-sm rounded-lg disabled:opacity-50 disabled:cursor-default" />
              </FieldWrap>
              <FieldWrap label="Zona horaria" icon={Clock} editing={editing}>
                <Input placeholder="America/Bogota" value={formData.timezone} disabled={!editing}
                  onChange={e => update("timezone", e.target.value)}
                  className="hive-input h-9 text-sm rounded-lg disabled:opacity-50 disabled:cursor-default" />
              </FieldWrap>
            </div>
          </section>

          <Divider />

          {/* NOTIFICACIONES */}
          <section>
            <SectionLabel>Notificaciones</SectionLabel>
            <FieldWrap label="Canal para Cron Jobs" icon={Bell} editing={editing}>
              <Select value={formData.preferred_cron_channel}
                onValueChange={v => update("preferred_cron_channel", v)} disabled={!editing}>
                <SelectTrigger className="hive-select-trigger h-9 text-sm rounded-lg disabled:opacity-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="hive-select-content">
                  <SelectItem value="auto" className="hive-select-item text-sm">
                    Auto — detectar mejor canal
                  </SelectItem>
                  {activeChannels.map(ch => (
                    <SelectItem key={ch.id} value={ch.id} className="hive-select-item text-sm">
                      {ch.id === 'webchat' ? 'Web Chat'
                        : ch.id === 'telegram' ? 'Telegram'
                        : ch.id === 'discord' ? 'Discord'
                        : ch.id === 'slack' ? 'Slack'
                        : ch.id === 'whatsapp' ? 'WhatsApp'
                        : ch.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldWrap>
          </section>

          <Divider />

          {/* CONTEXTO AGENTE */}
          <section>
            <SectionLabel>Contexto para el agente</SectionLabel>
            <Textarea
              placeholder="Describe tu perfil, preferencias de trabajo, estilo de comunicación..."
              value={formData.notes} disabled={!editing}
              onChange={e => update("notes", e.target.value)}
              className="hive-textarea text-sm rounded-lg min-h-[80px] disabled:opacity-50 disabled:cursor-default" />
          </section>
        </div>

        {/* ── Action buttons (sticky footer) ── */}
        <div className="px-4 sm:px-5 py-3 flex items-center justify-end gap-2 border-t"
          style={{ borderColor: "hsl(var(--hive-border-subtle))" }}>
          {editing ? (
            <>
              <button onClick={handleCancel}
                className="flex items-center gap-1.5 h-9 px-3 sm:px-4 rounded-lg text-xs font-semibold transition-all"
                style={{ background: "transparent", border: "1px solid hsl(var(--hive-border-base))", color: "hsl(var(--hive-text-muted))" }}>
                <X className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cancelar</span>
              </button>
              <button onClick={handleSave} disabled={isLoading}
                className="flex items-center gap-1.5 h-9 px-4 sm:px-5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-60"
                style={{ background: "hsl(var(--hive-blue-dark))", boxShadow: "var(--shadow-btn-primary)" }}>
                {isLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Guardar cambios</span>
                <span className="sm:hidden">Guardar</span>
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 h-9 px-4 sm:px-5 rounded-lg text-xs font-bold transition-all"
              style={{
                background: "hsl(var(--hive-amber)/0.12)",
                border: "1px solid hsl(var(--hive-amber)/0.3)",
                color: "hsl(var(--hive-amber))",
              }}>
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Editar perfil</span>
              <span className="sm:hidden">Editar</span>
            </button>
          )}
        </div>

        {/* Bottom blue strip */}
        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg,transparent,hsl(var(--hive-blue)/0.3),transparent)" }} />
      </div>
    </div>
  );
}
