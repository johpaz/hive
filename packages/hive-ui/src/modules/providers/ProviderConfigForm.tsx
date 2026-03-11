import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { swal } from "@/lib/swal";

import type { Provider } from "@/types";

interface ProviderConfigFormProps {
  provider?: Provider;
  onSave?: (data: { apiKey: string; baseUrl?: string; headers?: Record<string, string>; numCtx?: number | null }) => void;
  onCancel?: () => void;
}

export function ProviderConfigForm({ provider, onSave, onCancel }: ProviderConfigFormProps) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || provider?.base_url || "");
  const [headers, setHeaders] = useState(provider?.config?.headers ? JSON.stringify(provider.config.headers, null, 2) : "");
  const [numCtx, setNumCtx] = useState<string>(provider?.num_ctx ? String(provider.num_ctx) : "");

  const baseUrlValue = baseUrl || provider?.baseUrl || provider?.base_url || "";
  const isLocal = provider?.id === "ollama"
    || baseUrlValue.includes("localhost")
    || baseUrlValue.includes("127.0.0.1");

  const hasExistingKey = !!provider?.has_api_key;
  const hasExistingHeaders = !!provider?.has_headers;

  const handleSave = () => {
    let parsedHeaders = undefined;
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers.trim());
      } catch (e) {
        swal.fire("Error", "JSON de Headers inválido", "error");
        return;
      }
    }
    if (onSave) {
      onSave({
        apiKey,
        baseUrl: baseUrl || undefined,
        headers: parsedHeaders,
        numCtx: numCtx.trim() ? Number(numCtx.trim()) : null,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="hive-label">API Key</Label>
          {hasExistingKey && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Configurada
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasExistingKey ? "••••••••••••••••  (dejar vacío para conservar)" : "sk-..."}
            className="hive-input !h-8 text-xs pr-8"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-8 w-8 text-white/40 hover:text-white"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="hive-label">Base URL (opcional)</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
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
            placeholder="8192"
            min={512}
            step={512}
            className="hive-input !h-8 text-xs font-mono"
          />
          <p className="text-[10px] text-amber-400/60">
            Aumenta si ves errores de contexto. Tu modelo soporta hasta 262 144 tokens.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="hive-label">Custom Headers (JSON)</Label>
          {hasExistingHeaders && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Configurados
            </span>
          )}
        </div>
        <textarea
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          placeholder={hasExistingHeaders ? '{ ... }  (dejar vacío para conservar)' : '{ "x-custom-header": "value" }'}
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-white/70 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button className="hive-btn hive-btn--form-cancel flex-1" onClick={onCancel}>
          Cancelar
        </button>
        <button className="hive-btn hive-btn--form-submit flex-1" onClick={handleSave}>
          Guardar
        </button>
      </div>

      <p className="text-[10px] text-white/20 pt-2">
        La API key se guarda cifrada en la base de datos.
      </p>
    </div>
  );
}
