import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVoice } from "@/stores/useGlobalConfigStore";
import { Check, Key, Lock, Unlock } from "lucide-react";

const PROVIDER_INFO: Record<string, { name: string; description: string; logo: string; consoleUrl: string }> = {
  groq: {
    name: "Groq",
    description: "STT (Speech-to-Text) - Transcripción de audio ultra-rápida",
    logo: "🔴",
    consoleUrl: "https://console.groq.com/keys",
  },
  elevenlabs: {
    name: "ElevenLabs",
    description: "TTS (Text-to-Speech) - Voces neuronales de alta calidad",
    logo: "🎙️",
    consoleUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  openai: {
    name: "OpenAI",
    description: "STT/TTS - Whisper y TTS-1",
    logo: "🟢",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    name: "Google Gemini",
    description: "TTS - Voces de Gemini",
    logo: "🔵",
    consoleUrl: "https://aistudio.google.com/app/apikey",
  },
  qwen: {
    name: "Qwen (Alibaba)",
    description: "TTS - Voces de Qwen",
    logo: "🟣",
    consoleUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
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
    console.log("Remove key for:", providerId);
  };

  const providers = voiceProviders.length > 0 ? voiceProviders : Object.keys(PROVIDER_INFO);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {providers.map((providerId) => {
          const info = PROVIDER_INFO[providerId] || {
            name: providerId,
            description: "",
            logo: "🔌",
            consoleUrl: "#",
          };
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
                  {isConfigured ? (
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
                {isEditing ? (
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(info.consoleUrl, "_blank")}
                      >
                        Obtener Key
                      </Button>
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
