import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVoice, useProviders } from "@/stores/useGlobalConfigStore";
import { Check, Key, Lock, Unlock } from "lucide-react";
import { PiperTTSCard } from "./PiperTTSCard";
import { parseCapabilities } from "@/lib/capabilities";

// Metadata puramente visual (emoji + link a la consola del provider).
// La lista real de providers de voz y sus nombres vienen de la BD.
const PROVIDER_VISUALS: Record<string, { logo: string; consoleUrl?: string }> = {
  groq: { logo: "🔴", consoleUrl: "https://console.groq.com/keys" },
  elevenlabs: { logo: "🎙️", consoleUrl: "https://elevenlabs.io/app/settings/api-keys" },
  openai: { logo: "🟢", consoleUrl: "https://platform.openai.com/api-keys" },
  gemini: { logo: "🔵", consoleUrl: "https://aistudio.google.com/app/apikey" },
  qwen: { logo: "🟣", consoleUrl: "https://dashscope.console.aliyun.com/apiKey" },
  piper: { logo: "🖥️" },
};

export function VoiceProvidersPanel() {
  const {
    voiceProviders,
    configuredVoiceProviders,
    fetchVoiceProviders,
    fetchConfiguredVoiceProviders,
    saveVoiceProviderKey,
  } = useVoice();

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    fetchVoiceProviders();
    fetchConfiguredVoiceProviders();
  }, [fetchVoiceProviders, fetchConfiguredVoiceProviders]);

  const handleSaveKey = async (providerId: string) => {
    if (!apiKey.trim()) return;

    setIsSaving(true);
    try {
      await saveVoiceProviderKey(providerId, apiKey.trim());
      await fetchConfiguredVoiceProviders();
      setEditingProvider(null);
      setApiKey("");
    } catch (error) {
      console.error("Failed to save API key:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    // For now, we just clear it visually - backend would need an endpoint to delete
    // This is a placeholder for future implementation
  };

  const { providers: allProviders } = useProviders();

  // Info de cada provider derivada de la BD (nombre + modelos stt/tts embebidos)
  const getVoiceProviderInfo = (providerId: string) => {
    const providerRow = allProviders.find((p) => p.id === providerId);
    const pModels = (providerRow?.models || []) as Array<{ model_type?: string; capabilities?: string | null }>;
    const voiceOnly = pModels.filter((m) => m.model_type === "stt" || m.model_type === "tts");
    const hasStt = voiceOnly.some((m) => m.model_type === "stt");
    const hasTts = voiceOnly.some((m) => m.model_type === "tts");
    const isLocal = voiceOnly.some((m) => parseCapabilities(m.capabilities).includes("local"));
    const visuals = PROVIDER_VISUALS[providerId] || { logo: "🔌" };
    return {
      name: providerRow?.name || providerId,
      description: [hasStt && "STT (Speech-to-Text)", hasTts && "TTS (Text-to-Speech)"].filter(Boolean).join(" / "),
      logo: visuals.logo,
      consoleUrl: visuals.consoleUrl,
      noApiKey: isLocal,
    };
  };

  // Lista desde la BD; los locales (sin API key, ej. Piper) tienen su tarjeta dedicada (PiperTTSCard)
  const providers = voiceProviders.filter((id) => !getVoiceProviderInfo(id).noApiKey);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <PiperTTSCard />
        {providers.map((providerId) => {
          const info = getVoiceProviderInfo(providerId);
          const isConfigured = configuredVoiceProviders[providerId] === true;
          const isEditing = editingProvider === providerId;

          return (
            <Card key={providerId} className={`relative overflow-hidden ${isConfigured ? "border-green-500/30 bg-green-500/[0.02]" : ""}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{info.logo}</span>
                    <div>
                      <CardTitle className="text-lg">{info.name}</CardTitle>
                      <CardDescription className="text-xs">{info.description}</CardDescription>
                    </div>
                  </div>
                  {info.noApiKey ? (
                    <Badge variant="outline" className="bg-zinc-700/40 text-zinc-300 border-zinc-600">
                      Sin API key
                    </Badge>
                  ) : isConfigured ? (
                    <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                      <Check className="h-3 w-3 mr-1" />
                      Configurado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                      Sin configurar
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {info.noApiKey ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{info.description}</p>
                    <p className="text-xs text-muted-foreground/60">
                      Para usar Piper en un canal: ve a Canales → selecciona el canal → Voz → TTS Provider → <code>piper</code>
                    </p>
                  </div>
                ) : isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={`api-key-${providerId}`}>API Key</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          id={`api-key-${providerId}`}
                          type={showKey ? "text" : "password"}
                          placeholder="sk-..."
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          className="flex-1 font-mono text-sm"
                          autoFocus
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setShowKey(!showKey)}
                          title={showKey ? "Ocultar" : "Mostrar"}
                        >
                          {showKey ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSaveKey(providerId)}
                        disabled={isSaving || !apiKey.trim()}
                        className="flex-1"
                      >
                        {isSaving ? "Guardando..." : "Guardar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingProvider(null);
                          setApiKey("");
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {isConfigured ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Key className="h-4 w-4" />
                        <span>API key guardada de forma segura (encriptada)</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Necesitas una API key de {info.name} para usar esta funcionalidad.
                      </p>
                    )}
                    <div className="flex gap-2">
                      {!isConfigured ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditingProvider(providerId);
                            setApiKey("");
                          }}
                          className="flex-1"
                        >
                          <Key className="h-3 w-3 mr-2" />
                          Configurar API Key
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingProvider(providerId);
                            setApiKey("");
                          }}
                          className="flex-1"
                        >
                          <Key className="h-3 w-3 mr-2" />
                          Actualizar API Key
                        </Button>
                      )}
                      {info.consoleUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(info.consoleUrl, "_blank")}
                        >
                          Obtener Key
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">¿Cómo funciona?</CardTitle>
          <CardDescription>
            Configura las API keys de los providers de voz para habilitar las funcionalidades de STT y TTS en tus canales.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <strong className="text-foreground">STT (Speech-to-Text):</strong> Convierte el audio entrante en texto. Groq Whisper es recomendado por su velocidad y precisión.
          </div>
          <div>
            <strong className="text-foreground">TTS (Text-to-Speech):</strong> Convierte las respuestas de texto en audio. ElevenLabs ofrece las voces más naturales.
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs">
              Las API keys se guardan encriptadas en la base de datos local de Hive. Nunca se comparten ni envían a servidores externos.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
