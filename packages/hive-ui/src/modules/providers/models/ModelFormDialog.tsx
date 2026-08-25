import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Model, ModelFormData } from "@/types";
import { apiClient } from "@/lib/api";

interface AvailableModel {
  wire_id: string;
  id: string;
  already_added: boolean;
}

const MODEL_TYPES = [
  { value: "llm", label: "LLM (texto)" },
  { value: "vision", label: "Visión" },
  { value: "stt", label: "STT (voz → texto)" },
  { value: "tts", label: "TTS (texto → voz)" },
  { value: "embedding", label: "Embeddings" },
];

const CAPABILITIES = [
  "chat", "code", "vision", "reasoning",
  "function_calling", "json_mode", "streaming",
  "transcription", "tts", "speech",
];

interface ModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  /** Modelo a editar. Sin esto, el diálogo crea uno nuevo. */
  model?: Model;
  onSubmit: (data: ModelFormData) => Promise<void>;
  /** Abre el manual, para no repetir la explicación dentro del formulario. */
  onOpenGuide?: () => void;
  /** Providers cuyos modelos no cobran por token: pre-llena el costo en 0. */
  isFreeProvider?: boolean;
}

function parseCapabilities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** "" → null (sin tarifa), y sólo acepta números >= 0. */
function parsePriceInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ModelFormDialog({ open, onOpenChange, providerId, model, onSubmit, onOpenGuide, isFreeProvider }: ModelFormDialogProps) {
  const isEdit = !!model;

  const [tab, setTab] = useState<"discover" | "manual">("manual");
  const [available, setAvailable] = useState<AvailableModel[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [search, setSearch] = useState("");

  const [apiId, setApiId] = useState("");
  const [name, setName] = useState("");
  const [modelType, setModelType] = useState("llm");
  const [contextWindow, setContextWindow] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repuebla el formulario cada vez que se abre, para que no arrastre lo tipeado
  // en una apertura anterior sobre otro modelo.
  useEffect(() => {
    if (!open) return;
    setError(null);
    // El id guardado lleva el prefijo del revendedor; se edita el nombre de
    // cable, que el backend deriva y manda como `wire_id`.
    setApiId(model ? (model.wire_id ?? model.id) : "");
    setName(model?.name ?? "");
    setModelType(model?.model_type ?? "llm");
    const ctx = model?.contextWindow ?? model?.context_window;
    setContextWindow(ctx ? String(ctx) : "");
    const input = model?.input_per_1m ?? model?.inputPer1M;
    const output = model?.output_per_1m ?? model?.outputPer1M;
    // Un provider gratuito arranca en 0 explícito: dejarlo vacío lo marcaría
    // "sin tarifa", que suma $0 al dashboard por falta de dato y no por ser gratis.
    const freeDefault = !model && isFreeProvider ? "0" : "";
    setInputPrice(typeof input === "number" ? String(input) : freeDefault);
    setOutputPrice(typeof output === "number" ? String(output) : freeDefault);
    setCapabilities(parseCapabilities(model?.capabilities));

    // Al editar no tiene sentido explorar; al crear se arranca en Descubrir.
    setTab(model ? "manual" : "discover");
    setSearch("");
    setAvailable(null);
    setDiscoverError(null);
  }, [open, model, providerId, isFreeProvider]);

  // Pide la lista real al provider la primera vez que se entra a Descubrir.
  useEffect(() => {
    if (!open || tab !== "discover" || available !== null || discovering) return;
    setDiscovering(true);
    setDiscoverError(null);
    apiClient<{ models: AvailableModel[] }>(`/api/providers/${encodeURIComponent(providerId)}/available-models`)
      .then((data) => setAvailable(data.models ?? []))
      .catch((err) => setDiscoverError((err as Error).message || "No se pudo consultar el provider."))
      .finally(() => setDiscovering(false));
  }, [open, tab, providerId, available, discovering]);

  const filtered = useMemo(() => {
    if (!available) return [];
    const q = search.trim().toLowerCase();
    return q ? available.filter((m) => m.wire_id.toLowerCase().includes(q)) : available;
  }, [available, search]);

  /** Pasa el modelo elegido al formulario para que se completen contexto y precio. */
  const pickDiscovered = (m: AvailableModel) => {
    setApiId(m.wire_id);
    setName(m.wire_id.split("/").pop() || m.wire_id);
    setTab("manual");
  };

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
  };

  const handleSubmit = async () => {
    const trimmedId = apiId.trim();
    if (!trimmedId) {
      setError("El ID del modelo en la API es obligatorio.");
      return;
    }
    const ctx = Number(contextWindow.trim());
    if (contextWindow.trim() && (!Number.isFinite(ctx) || ctx <= 0)) {
      setError("El contexto debe ser un número mayor que cero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        id: trimmedId,
        name: name.trim() || trimmedId,
        model_type: modelType,
        context_window: contextWindow.trim() ? ctx : undefined,
        input_per_1m: parsePriceInput(inputPrice),
        output_per_1m: parsePriceInput(outputPrice),
        capabilities: capabilities.length ? capabilities : null,
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "No se pudo guardar el modelo.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full bg-white/5 border border-white/10 rounded-md px-2.5 h-8 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:border-blue-500/50 transition-all";
  const labelClass = "block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl border border-white/10 p-0 overflow-hidden w-[calc(100vw-2rem)] max-w-lg bg-[#09090b]">
        <div className="p-5 border-b border-white/5 bg-white/5 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-32 w-32 bg-blue-600/10 rounded-full blur-[80px] pointer-events-none" />
          <DialogTitle className="text-lg font-black text-white uppercase tracking-tighter">
            {isEdit ? "Editar modelo" : "Nuevo modelo"}
          </DialogTitle>
          <div className="flex items-start justify-between gap-3">
            <DialogDescription className="text-xs text-white/40 font-medium mt-0.5">
              {providerId} — los precios alimentan el costo del dashboard.
            </DialogDescription>
            {onOpenGuide && (
              <button
                type="button"
                onClick={onOpenGuide}
                className="shrink-0 h-6 px-2 rounded-md bg-white/5 border border-white/10 text-white/50 text-[10px] font-black uppercase tracking-widest hover:text-white hover:bg-white/10 transition-colors"
              >
                ? Guía
              </button>
            )}
          </div>
        </div>

        {!isEdit && (
          <div className="flex gap-1 px-5 pt-3">
            {([["discover", "Descubrir"], ["manual", "Manual"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`h-7 px-3 rounded-md text-[10px] font-black uppercase tracking-widest border transition-colors ${
                  tab === id
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    : 'bg-transparent border-white/10 text-white/35 hover:text-white/70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!isEdit && tab === "discover" && (
          <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto hive-scroll">
            <p className="text-[11px] text-white/40 leading-relaxed">
              Modelos que <span className="text-white/70">{providerId}</span> sirve en este momento. Elegir de acá
              evita guardar un ID que no existe o que fue retirado — eso no falla al guardar, falla después en plena
              conversación.
            </p>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo…"
              className={`${inputClass} font-mono`}
            />

            {discovering && <p className="text-[11px] text-white/30 py-4 text-center">Consultando al provider…</p>}

            {discoverError && (
              <div className="text-[11px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded-md px-2.5 py-2">
                {discoverError}
                <p className="text-white/40 mt-1">
                  Este provider puede no publicar su lista de modelos. Usá la pestaña Manual.
                </p>
              </div>
            )}

            {available && !discovering && (
              <>
                <p className="text-[10px] text-white/30">
                  {filtered.length} de {available.length} modelos
                </p>
                <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto hive-scroll pr-1">
                  {filtered.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={m.already_added}
                      onClick={() => pickDiscovered(m)}
                      className={`flex items-center justify-between gap-2 text-left rounded-md px-2.5 py-1.5 border transition-colors ${
                        m.already_added
                          ? 'border-transparent opacity-35 cursor-not-allowed'
                          : 'border-transparent hover:bg-white/5 hover:border-white/10'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-white/70 truncate">{m.wire_id}</span>
                      {m.already_added && (
                        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-400/70">
                          ya está
                        </span>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-[11px] text-white/25 py-3 text-center">Ningún modelo coincide.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {(isEdit || tab === "manual") && (
        <div className="p-5 space-y-3.5 max-h-[65vh] overflow-y-auto hive-scroll">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>ID en la API *</label>
              <input
                className={`${inputClass} font-mono`}
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                placeholder="claude-sonnet-5"
              />
              <p className="text-[10px] text-white/25 mt-1">Tal cual lo espera el provider.</p>
            </div>
            <div>
              <label className={labelClass}>Nombre visible</label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Sonnet 5"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Tipo</label>
              <select
                className={inputClass}
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
              >
                {MODEL_TYPES.map((t) => (
                  <option key={t.value} value={t.value} className="bg-[#09090b]">{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Contexto (tokens)</label>
              <input
                type="number"
                min={0}
                className={`${inputClass} font-mono`}
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="200000"
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className={`${labelClass} mb-0`}>Costo — USD por millón de tokens</span>
              <span className="text-[10px] text-white/25">Vacío = sin tarifa</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  className={`${inputClass} font-mono`}
                  value={inputPrice}
                  onChange={(e) => setInputPrice(e.target.value)}
                  placeholder="Entrada — 3"
                />
              </div>
              <div>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  className={`${inputClass} font-mono`}
                  value={outputPrice}
                  onChange={(e) => setOutputPrice(e.target.value)}
                  placeholder="Salida — 15"
                />
              </div>
            </div>
            <p className="text-[10px] text-white/25 mt-1">
              Pon <span className="font-mono text-white/40">0</span> si el endpoint es gratuito: dejarlo vacío marca el
              modelo como “sin tarifa” y su consumo se contabiliza como $0 sin avisar en el dashboard.
            </p>
          </div>

          <div>
            <label className={labelClass}>Capacidades</label>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITIES.map((cap) => {
                const on = capabilities.includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCapability(cap)}
                    className={`text-[10px] font-mono rounded px-2 py-1 leading-none border transition-colors ${
                      on
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                        : 'bg-white/5 border-white/10 text-white/30 hover:text-white/60'
                    }`}
                  >
                    {cap}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-1.5">
              {error}
            </p>
          )}
        </div>
        )}

        {(isEdit || tab === "manual") && (
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="hive-btn hive-btn--ghost h-8 px-3 text-[10px] font-black uppercase tracking-widest text-white/40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !apiId.trim()}
            className="h-8 px-3.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Guardando…" : isEdit ? "Guardar" : "Agregar"}
          </button>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
