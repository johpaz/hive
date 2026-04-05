import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { swal } from "@/lib/swal";

interface NewProviderFormProps {
  onSave: (data: {
    id: string;
    name: string;
    type: string;
    apiKey: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    numCtx?: number | null;
  }) => void;
  onCancel: () => void;
}

export function NewProviderForm({ onSave, onCancel }: NewProviderFormProps) {
  const [showKey, setShowKey] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [numCtx, setNumCtx] = useState<string>("");

  const isLocal = type.toLowerCase() === "ollama" || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");

  const handleSave = () => {
    if (!name.trim()) {
      swal.fire("Error", "El nombre del provider es requerido", "error");
      return;
    }
    if (!type) {
      swal.fire("Error", "Selecciona un tipo de provider", "error");
      return;
    }
    if (!apiKey.trim() && !isLocal) {
      swal.fire("Error", "La API Key es requerida para este provider", "error");
      return;
    }

    let parsedHeaders = undefined;
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers.trim());
      } catch (e) {
        swal.fire("Error", "JSON de Headers inválido", "error");
        return;
      }
    }

    onSave({
      id: name.trim().toLowerCase().replace(/\s+/g, "-"),
      name: name.trim(),
      type,
      apiKey: apiKey.trim() || "",
      baseUrl: baseUrl.trim() || undefined,
      headers: parsedHeaders,
      numCtx: numCtx.trim() ? Number(numCtx.trim()) : null,
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="hive-label">Nombre del Provider</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mi Provider Personalizado"
          className="hive-input !h-8 text-xs"
        />
        <p className="text-[10px] text-white/30">Se usará como identificador interno</p>
      </div>

      <div className="space-y-1">
        <Label className="hive-label">Tipo de Provider</Label>
        <Input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="openai, anthropic, ollama..."
          className="hive-input !h-8 text-xs"
        />
        <p className="text-[10px] text-white/30">Ej: openai, anthropic, ollama, custom...</p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="hive-label">API Key</Label>
        </div>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={isLocal ? "Opcional para providers locales" : "sk-..."}
            className="hive-input !h-8 text-xs pr-8"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-0 top-0 h-8 w-8 flex items-center justify-center text-white/40 hover:text-white"
          >
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="hive-label">Base URL (opcional)</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com o http://localhost:11434"
          className="hive-input !h-8 text-xs"
        />
      </div>

      {isLocal && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="hive-label">Context Window (num_ctx)</Label>
            <span className="text-[10px] text-white/30">tokens — por defecto 32 768</span>
          </div>
          <Input
            type="number"
            value={numCtx}
            onChange={(e) => setNumCtx(e.target.value)}
            placeholder="32768"
            min={512}
            step={512}
            className="hive-input !h-8 text-xs font-mono"
          />
          <p className="text-[10px] text-amber-400/60">
            Aumenta si ves errores de contexto.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="hive-label">Custom Headers (JSON)</Label>
        </div>
        <textarea
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          placeholder='{ "x-custom-header": "value" }'
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white/70 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button className="hive-btn hive-btn--form-cancel flex-1" onClick={onCancel}>
          Cancelar
        </button>
        <button className="hive-btn hive-btn--form-submit flex-1" onClick={handleSave}>
          Crear Provider
        </button>
      </div>

      <p className="text-[10px] text-white/20 pt-2">
        La API key se guarda cifrada en la base de datos.
      </p>
    </div>
  );
}
