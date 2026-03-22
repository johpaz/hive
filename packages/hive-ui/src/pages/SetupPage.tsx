import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, Sparkles, Hexagon, Volume2, Loader2 } from "lucide-react";
import { useLoaderStore } from "@/stores/useLoaderStore";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/gateway-url";
import { swal } from "@/lib/swal";

const PROVIDER_LOGOS: Record<string, string> = {
  gemini: "🔵", anthropic: "🟠", openai: "🟢", groq: "🔴",
  ollama: "🟣", openrouter: "🟡", deepseek: "🔷", mistral: "🔸", kimi: "🌙",
};

const PROVIDER_API_LINKS: Record<string, string> = {
  gemini: "https://aistudio.google.com/app/apikey",
  anthropic: "https://console.anthropic.com/keys",
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  kimi: "https://platform.moonshot.cn/console/api-keys",
};

const CHANNELS = [
  { id: "webchat", name: "WebChat", description: "Chat web integrado", icon: "💬", required: true },
  { id: "telegram", name: "Telegram", description: "Bot de Telegram", icon: "✈️", required: false },
  { id: "discord", name: "Discord", description: "Bot de Discord", icon: "🎮", required: false },
  { id: "whatsapp", name: "WhatsApp", description: "Bot de WhatsApp", icon: "📱", required: false },
  { id: "slack", name: "Slack", description: "Bot de Slack", icon: "💼", required: false },
];


interface WizardData {
  // Step 1
  userName: string;
  userLanguage: string;
  userTimezone: string;
  userOccupation: string;
  userNotes: string;
  // Step 2
  agentName: string;
  agentDescription: string;
  // Step 3
  provider: string;
  apiKey: string;
  model: string;
  apiKeyVerified: boolean;
  // Step 4
  channels: Record<string, { enabled: boolean; config?: Record<string, string> }>;
  // Step 5
  voiceEnabled: boolean;
  sttProvider: string;
  ttsProvider: string;
  ttsVoice: string;
  // Step 6
  ethicsRules: Record<string, boolean>;
  customRules: Array<{ text: string; category: string }>;
}

const STORAGE_KEY = "hive_setup_wizard_data";

function loadWizardData(): WizardData | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new properties added in updates
      return { ...getDefaultWizardData(), ...parsed };
    }
  } catch (e) {
    console.error("Failed to load wizard data:", e);
  }
  return null;
}

function saveWizardData(data: WizardData): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save wizard data:", e);
  }
}

function clearWizardData(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear wizard data:", e);
  }
}

function getDefaultWizardData(): WizardData {
  return {
    userName: "",
    userLanguage: "es",
    userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    userOccupation: "",
    userNotes: "",
    agentName: "Bee",
    agentDescription: "",
    provider: "",
    apiKey: "",
    model: "",
    apiKeyVerified: false,
    channels: {
      webchat: { enabled: true },
      telegram: { enabled: false },
      discord: { enabled: false },
      whatsapp: { enabled: false },
      slack: { enabled: false },
    },
    voiceEnabled: false,
    sttProvider: "groq-whisper",
    ttsProvider: "elevenlabs",
    ttsVoice: "",
    ethicsRules: {},
    customRules: [],
  };
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>(() => {
    const loaded = loadWizardData();
    return loaded || getDefaultWizardData();
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const { showLoader, hideLoader } = useLoaderStore();
  const [verificationStatus, setVerificationStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [stepError, setStepError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string; models: { id: string; name: string }[] }[]>([]);
  const [ethicsList, setEthicsList] = useState<{ id: string; name: string; description: string | null; content: string; isDefault: boolean; active: boolean }[]>([]);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/setup/providers`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setProviders(data); })
      .catch(() => { });
    fetch(`${getApiBaseUrl()}/api/setup/ethics`)
      .then(res => res.json())
      .then((data: { id: string; name: string; description: string | null; content: string; isDefault: boolean; active: boolean }[]) => {
        if (Array.isArray(data)) {
          setEthicsList(data);
          // Initialize ethicsRules with all enabled by default if not already set
          setWizardData(prev => {
            if (Object.keys(prev.ethicsRules).length === 0) {
              return { ...prev, ethicsRules: Object.fromEntries(data.map(e => [e.id, true])) };
            }
            return prev;
          });
        }
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    saveWizardData(wizardData);
  }, [wizardData]);

  useEffect(() => {
    // Check if already configured
    fetch(`${getApiBaseUrl()}/api/setup/status`)
      .then(res => res.json())
      .then(data => {
        if (data.configured) {
          navigate("/ui");
        }
      })
      .catch(() => {
        // API might not exist yet, continue
      });
  }, [navigate]);

  const updateData = (updates: Partial<WizardData>) => {
    setStepError(null);
    setWizardData(prev => ({ ...prev, ...updates }));
  };

  const getStepError = (): string | null => {
    switch (currentStep) {
      case 1:
        if (!wizardData.userName.trim()) return "El nombre es obligatorio.";
        if (wizardData.userName.trim().length < 2) return "El nombre debe tener al menos 2 caracteres.";
        return null;
      case 2:
        if (!wizardData.agentName.trim()) return "El nombre del agente es obligatorio.";
        if (wizardData.agentName.trim().length < 2) return "El nombre debe tener al menos 2 caracteres.";
        return null;
      case 3:
        if (!wizardData.provider) return "Selecciona un proveedor LLM.";
        if (wizardData.provider !== "ollama" && !wizardData.apiKey) return "Ingresa tu API key.";
        if (wizardData.provider !== "ollama" && !wizardData.apiKeyVerified) return "Verifica tu API key antes de continuar.";
        if (!wizardData.model) return "Selecciona un modelo.";
        return null;
      default:
        return null;
    }
  };

  const canProceed = (): boolean => getStepError() === null;

  const handleNext = () => {
    const error = getStepError();
    if (error) { setStepError(error); return; }
    setStepError(null);
    if (currentStep < 7) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleReset = () => {
    if (confirm("¿Estás seguro de que quieres reiniciar la configuración? Se perderá todo el progreso.")) {
      clearWizardData();
      setWizardData(getDefaultWizardData());
      setCurrentStep(1);
    }
  };

  const verifyApiKey = async () => {
    if (!wizardData.apiKey || !wizardData.provider) return;

    setVerificationStatus("verifying");
    try {
      const result = await apiClient<{ success: boolean }>("/api/setup/verify-provider", {
        method: "POST",
        body: {
          provider: wizardData.provider,
          apiKey: wizardData.apiKey,
        },
        showLoader: "Verificando conexión...",
        showError: false
      });

      if (result.success) {
        setVerificationStatus("success");
        updateData({ apiKeyVerified: true });
      } else {
        setVerificationStatus("error");
        updateData({ apiKeyVerified: false });
      }
    } catch (error) {
      setVerificationStatus("error");
      updateData({ apiKeyVerified: false });
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const result = await apiClient<{ success: boolean; authToken?: string; error?: string }>("/api/setup/complete", {
        method: "POST",
        body: wizardData,
        showLoader: "Finalizando configuración...",
        showError: true
      });

      if (result.success) {
        const authToken = result.authToken;
        if (authToken) {
          localStorage.setItem("hive-auth-token", authToken);
        }
        setSubmitSuccess(true);
        clearWizardData();
        // Server restarts after setup — poll setup/status until configured: true
        // Navigate with ?token= so App.tsx always overwrites any stale localStorage token
        const waitForRestart = async () => {
          await new Promise(r => setTimeout(r, 1500)); // wait for restart to begin
          showLoader(`Iniciando a ${wizardData.agentName}... esto toma unos segundos`);
          for (let i = 0; i < 40; i++) {
            try {
              const res = await fetch(`${getApiBaseUrl()}/api/setup/status`);
              if (res.ok) {
                const { configured } = await res.json();
                if (configured) {
                  hideLoader();
                  navigate(authToken ? `/?token=${authToken}` : "/");
                  return;
                }
              }
            } catch { /* server still restarting */ }
            await new Promise(r => setTimeout(r, 1000));
          }
          hideLoader();
          navigate(authToken ? `/?token=${authToken}` : "/"); // fallback after 40s
        };
        waitForRestart();
      }
    } catch (error) {
      // Error handled by apiClient
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      case 5:
        return renderStep5();
      case 6:
        return renderStep6();
      case 7:
        return renderStep7();
      default:
        return null;
    }
  };

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="relative">
            <Hexagon className="w-24 h-24 text-amber-500" fill="currentColor" />
            <Sparkles className="w-8 h-8 text-amber-300 absolute -top-2 -right-2" />
          </div>
        </div>
        <h1 className="text-3xl font-bold">Bienvenido a Hive</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Hive es tu colmena de agentes IA. Local-first. Multi-canal. Open source.
          En los próximos minutos configurarás tu agente personal Bee.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tu información</CardTitle>
          <CardDescription>Comencemos con tus datos básicos</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="userName">Tu nombre</Label>
            <Input
              id="userName"
              placeholder="¿Cómo te llamas?"
              value={wizardData.userName}
              onChange={(e) => updateData({ userName: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="userLanguage">Idioma preferido</Label>
            <Select
              value={wizardData.userLanguage}
              onValueChange={(value) => updateData({ userLanguage: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
                <SelectItem value="fr">Français</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="userTimezone">Zona horaria</Label>
            <Input
              id="userTimezone"
              value={wizardData.userTimezone}
              onChange={(e) => updateData({ userTimezone: e.target.value })}
              placeholder="America/Bogota"
            />
            <p className="text-xs text-muted-foreground">
              Detectada automáticamente: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="userOccupation">Ocupación <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <Input
              id="userOccupation"
              value={wizardData.userOccupation}
              onChange={(e) => updateData({ userOccupation: e.target.value })}
              placeholder="Ej: Desarrollador de software, diseñador, estudiante..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="userNotes">Preferencias de comunicación <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <textarea
              id="userNotes"
              className="w-full min-h-[80px] p-3 border rounded-md bg-background resize-none text-sm"
              value={wizardData.userNotes}
              onChange={(e) => updateData({ userNotes: e.target.value })}
              placeholder="Ej: Prefiero respuestas cortas y directas. Usa ejemplos de código cuando expliques conceptos técnicos..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Tu agente</h2>
        <p className="text-muted-foreground">Personaliza a Bee, tu agente personal</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identidad del agente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agentName">Nombre del agente</Label>
            <Input
              id="agentName"
              value={wizardData.agentName}
              onChange={(e) => updateData({ agentName: e.target.value })}
              placeholder="Bee"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agentDescription">Descripción / Personalidad</Label>
            <textarea
              id="agentDescription"
              className="w-full min-h-[100px] p-3 border rounded-md bg-background resize-none"
              value={wizardData.agentDescription}
              onChange={(e) => updateData({ agentDescription: e.target.value })}
              placeholder="Ej: Eres un asistente útil y amable. Respondes de forma concisa pero completa. Te especializas en ayudar con tareas de programación y productividad..."
            />
          </div>

        </CardContent>
      </Card>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Proveedor LLM</h2>
        <p className="text-muted-foreground">Selecciona el cerebro de tu agente</p>
      </div>

      <div className="grid gap-3">
        {providers.map((provider) => (
          <Card
            key={provider.id}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              wizardData.provider === provider.id && "border-amber-500 ring-2 ring-amber-500"
            )}
            onClick={() => updateData({ provider: provider.id, model: "", apiKeyVerified: false })}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <span className="text-3xl">{PROVIDER_LOGOS[provider.id] ?? "🤖"}</span>
              <div className="flex-1">
                <h3 className="font-semibold">{provider.name}</h3>
                <p className="text-sm text-muted-foreground">{provider.models.length} modelo{provider.models.length !== 1 ? "s" : ""} disponible{provider.models.length !== 1 ? "s" : ""}</p>
              </div>
              {wizardData.provider === provider.id && (
                <CheckCircle2 className="w-5 h-5 text-amber-500" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {wizardData.provider && (() => {
        const selectedProvider = providers.find(p => p.id === wizardData.provider);
        return (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Configuración de {selectedProvider?.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {wizardData.provider !== "ollama" && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apiKey"
                      type="password"
                      value={wizardData.apiKey}
                      onChange={(e) => updateData({ apiKey: e.target.value, apiKeyVerified: false })}
                      placeholder="sk-..."
                      className={cn(stepError?.includes("API key") && !wizardData.apiKey && "border-red-500")}
                    />
                    <Button
                      variant="outline"
                      onClick={verifyApiKey}
                      disabled={!wizardData.apiKey || verificationStatus === "verifying"}
                    >
                      {verificationStatus === "verifying" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : verificationStatus === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : verificationStatus === "error" ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        "Verificar"
                      )}
                    </Button>
                  </div>
                  {verificationStatus === "success" && (
                    <p className="text-sm text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> API key verificada correctamente
                    </p>
                  )}
                  {verificationStatus === "error" && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <XCircle className="w-4 h-4" /> API key inválida o error de conexión
                    </p>
                  )}
                  {PROVIDER_API_LINKS[wizardData.provider] && (
                    <p className="text-xs text-muted-foreground">
                      ¿No tienes tu API key?{" "}
                      <a
                        href={PROVIDER_API_LINKS[wizardData.provider]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-500 hover:underline"
                      >
                        Obtener aquí
                      </a>
                    </p>
                  )}
                </div>
              )}

              {(wizardData.provider === "ollama" || wizardData.apiKeyVerified) && (
                <div className="space-y-2">
                  <Label htmlFor="model">Modelo</Label>
                  <Select
                    value={wizardData.model}
                    onValueChange={(value) => updateData({ model: value })}
                  >
                    <SelectTrigger className={cn(!wizardData.model && stepError?.includes("modelo") && "border-red-500")}>
                      <SelectValue placeholder="Selecciona un modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedProvider?.models ?? []).map((m, i) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name || m.id}{i === 0 ? " (Recomendado)" : ""}
                        </SelectItem>
                      ))}
                      {wizardData.provider === "ollama" && (selectedProvider?.models ?? []).length === 0 && (
                        <SelectItem value="llama3.2:3b">llama3.2:3b (Recomendado)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Canales</h2>
        <p className="text-muted-foreground">¿Dónde quieres que Bee esté disponible?</p>
      </div>

      <div className="grid gap-3">
        {CHANNELS.map((channel) => (
          <Card
            key={channel.id}
            className={cn(
              "transition-all",
              wizardData.channels[channel.id]?.enabled && "border-amber-500"
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{channel.icon}</span>
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      {channel.name}
                      {channel.required && (
                        <Badge variant="secondary" className="text-xs">Requerido</Badge>
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground">{channel.description}</p>
                  </div>
                </div>
                <Switch
                  checked={wizardData.channels[channel.id]?.enabled}
                  onCheckedChange={(checked) => {
                    if (channel.required && !checked) return;
                    updateData({
                      channels: {
                        ...wizardData.channels,
                        [channel.id]: { enabled: checked },
                      },
                    });
                  }}
                  disabled={channel.required}
                />
              </div>

              {!channel.required && wizardData.channels[channel.id]?.enabled && (
                <Accordion type="single" collapsible className="mt-4">
                  <AccordionItem value="config">
                    <AccordionTrigger>Configuración</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {channel.id === "telegram" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="telegramToken">Token del Bot</Label>
                              <Input
                                id="telegramToken"
                                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                                value={wizardData.channels.telegram.config?.botToken || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    telegram: { enabled: true, config: { botToken: e.target.value } },
                                  },
                                })}
                              />
                              <p className="text-xs text-muted-foreground">
                                <a
                                  href="https://t.me/BotFather"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-amber-500 hover:underline"
                                >
                                  Obtén tu token en BotFather
                                </a>
                              </p>
                            </div>
                          </>
                        )}
                        {channel.id === "discord" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="discordToken">Token del Bot</Label>
                              <Input
                                id="discordToken"
                                placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GJKlMn.OpQrStUvWxYz"
                                value={wizardData.channels.discord.config?.botToken || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    discord: { enabled: true, config: { botToken: e.target.value } },
                                  },
                                })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="discordClientId">Client ID</Label>
                              <Input
                                id="discordClientId"
                                placeholder="1234567890123456789"
                                value={wizardData.channels.discord.config?.clientId || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    discord: { enabled: true, config: { clientId: e.target.value } },
                                  },
                                })}
                              />
                            </div>
                          </>
                        )}
                        {channel.id === "whatsapp" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="whatsappToken">Token de la API</Label>
                              <Input
                                id="whatsappToken"
                                placeholder="..."
                                value={wizardData.channels.whatsapp.config?.apiToken || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    whatsapp: { enabled: true, config: { apiToken: e.target.value } },
                                  },
                                })}
                              />
                            </div>
                          </>
                        )}
                        {channel.id === "slack" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="slackToken">Bot Token</Label>
                              <Input
                                id="slackToken"
                                placeholder="xoxb-..."
                                value={wizardData.channels.slack.config?.botToken || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    slack: { enabled: true, config: { botToken: e.target.value } },
                                  },
                                })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="slackSigningSecret">Signing Secret</Label>
                              <Input
                                id="slackSigningSecret"
                                placeholder="..."
                                value={wizardData.channels.slack.config?.signingSecret || ""}
                                onChange={(e) => updateData({
                                  channels: {
                                    ...wizardData.channels,
                                    slack: { enabled: true, config: { signingSecret: e.target.value } },
                                  },
                                })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Voz (opcional)</h2>
        <p className="text-muted-foreground">Permite que Bee hable y escuche</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Activar voz</CardTitle>
            <Switch
              checked={wizardData.voiceEnabled}
              onCheckedChange={(checked) => updateData({ voiceEnabled: checked })}
            />
          </div>
        </CardHeader>
        <CardContent>
          {wizardData.voiceEnabled ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sttProvider">Reconocimiento de voz (STT)</Label>
                <Select
                  value={wizardData.sttProvider}
                  onValueChange={(value) => updateData({ sttProvider: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="groq-whisper">
                      Groq Whisper (Recomendado)
                    </SelectItem>
                    <SelectItem value="openai-whisper">
                      OpenAI Whisper
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsProvider">Síntesis de voz (TTS)</Label>
                <Select
                  value={wizardData.ttsProvider}
                  onValueChange={(value) => updateData({ ttsProvider: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="elevenlabs">
                      ElevenLabs (Recomendado)
                    </SelectItem>
                    <SelectItem value="openai">
                      OpenAI TTS
                    </SelectItem>
                    <SelectItem value="gemini">
                      Google Gemini
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsVoice">Voz</Label>
                <div className="flex gap-2">
                  <Select
                    value={wizardData.ttsVoice}
                    onValueChange={(value) => updateData({ ttsVoice: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una voz" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Rachel">Rachel (ElevenLabs)</SelectItem>
                      <SelectItem value="Adam">Adam (ElevenLabs)</SelectItem>
                      <SelectItem value="Antoni">Antoni (ElevenLabs)</SelectItem>
                      <SelectItem value="Elli">Elli (ElevenLabs)</SelectItem>
                      <SelectItem value="Josh">Josh (ElevenLabs)</SelectItem>
                      <SelectItem value="alloy">Alloy (OpenAI)</SelectItem>
                      <SelectItem value="echo">Echo (OpenAI)</SelectItem>
                      <SelectItem value="fable">Fable (OpenAI)</SelectItem>
                      <SelectItem value="onyx">Onyx (OpenAI)</SelectItem>
                      <SelectItem value="nova">Nova (OpenAI)</SelectItem>
                      <SelectItem value="shimmer">Shimmer (OpenAI)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon">
                    <Volume2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <Alert>
                <AlertDescription className="text-sm">
                  {wizardData.provider === wizardData.ttsProvider && (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Ya tienes la API key configurada
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              Puedes activar la voz más tarde en la configuración
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderStep6 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Reglas éticas</h2>
        <p className="text-muted-foreground">Define los límites de tu agente</p>
      </div>

      <Alert>
        <AlertDescription className="text-sm">
          Las reglas de categoría <strong className="text-red-500">NUNCA</strong> son las protecciones más importantes.
          Desactivarlas puede comprometer la seguridad.
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        {ethicsList.map((ethics) => {
          const enabled = wizardData.ethicsRules[ethics.id] !== false;
          return (
            <Card key={ethics.id} className={cn(!enabled && "opacity-60")}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(checked) => {
                      if (ethics.isDefault && !checked) {
                        if (!confirm("¿Estás seguro de desactivar los lineamientos éticos por defecto?")) {
                          return;
                        }
                      }
                      updateData({
                        ethicsRules: { ...wizardData.ethicsRules, [ethics.id]: checked as boolean },
                      });
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{ethics.name}</h3>
                      {ethics.isDefault && <Badge className="text-xs bg-blue-500/10 text-blue-500">Por defecto</Badge>}
                    </div>
                    {ethics.description && (
                      <p className="text-sm text-muted-foreground mt-1">{ethics.description}</p>
                    )}
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Ver contenido</summary>
                      <pre className="text-xs mt-2 p-2 bg-muted rounded whitespace-pre-wrap font-mono">{ethics.content}</pre>
                    </details>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {ethicsList.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Cargando lineamientos éticos...</p>
        )}
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          const text = prompt("Ingresa tu regla personalizada:");
          if (text) {
            const category = prompt("Categoría (SIEMPRE/NUNCA/CONFIRMAR):", "CONFIRMAR");
            if (category && ["SIEMPRE", "NUNCA", "CONFIRMAR"].includes(category.toUpperCase())) {
              updateData({
                customRules: [
                  ...wizardData.customRules,
                  { text, category: category.toUpperCase() },
                ],
              });
            }
          }
        }}
      >
        + Añadir regla personalizada
      </Button>

      {wizardData.customRules.length > 0 && (
        <div className="space-y-2">
          <Label>Reglas personalizadas</Label>
          {wizardData.customRules.map((rule, index) => (
            <Card key={index}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{rule.text}</p>
                  <Badge className={cn(
                    "text-xs mt-1",
                    rule.category === "NUNCA" && "text-red-500 bg-red-500/10",
                    rule.category === "SIEMPRE" && "text-green-500 bg-green-500/10",
                    rule.category === "CONFIRMAR" && "text-amber-500 bg-amber-500/10"
                  )}>
                    {rule.category}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    updateData({
                      customRules: wizardData.customRules.filter((_, i) => i !== index),
                    });
                  }}
                >
                  Eliminar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderStep7 = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">¡Todo listo!</h2>
        <p className="text-muted-foreground">Revisa tu configuración antes de continuar</p>
      </div>

      {submitSuccess ? (
        <Card className="border-green-500 bg-green-500/10">
          <CardContent className="p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="relative">
                <Hexagon className="w-24 h-24 text-amber-500 animate-pulse" fill="currentColor" />
                <Sparkles className="w-8 h-8 text-amber-300 absolute -top-2 -right-2 animate-bounce" />
              </div>
            </div>
            <h3 className="text-xl font-bold">¡Bienvenido a Hive!</h3>
            <p className="text-muted-foreground">
              {wizardData.agentName} está listo para ayudarte.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-500">
                  <Hexagon className="w-6 h-6 text-white" fill="currentColor" />
                </div>
                {wizardData.agentName}
              </CardTitle>
              <CardDescription>{wizardData.agentDescription || "Sin descripción"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Proveedor</Label>
                <p className="font-medium">
                  {providers.find(p => p.id === wizardData.provider)?.name || wizardData.provider} — {wizardData.model}
                </p>
              </div>

              <div>
                <Label className="text-sm text-muted-foreground">Canales activos</Label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {Object.entries(wizardData.channels)
                    .filter(([_, data]) => data.enabled)
                    .map(([id]) => {
                      const channel = CHANNELS.find(c => c.id === id);
                      return (
                        <Badge key={id} variant="secondary">
                          {channel?.icon} {channel?.name}
                        </Badge>
                      );
                    })}
                </div>
              </div>

              {wizardData.voiceEnabled && (
                <div>
                  <Label className="text-sm text-muted-foreground">Voz</Label>
                  <p className="font-medium">
                    STT: {wizardData.sttProvider} | TTS: {wizardData.ttsProvider}
                    {wizardData.ttsVoice && ` (${wizardData.ttsVoice})`}
                  </p>
                </div>
              )}

              <div>
                <Label className="text-sm text-muted-foreground">Reglas éticas activas</Label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {Object.entries(wizardData.ethicsRules)
                    .filter(([_, enabled]) => enabled)
                    .map(([id]) => {
                      const ethics = ethicsList.find(e => e.id === id);
                      return (
                        <Badge key={id} variant="outline">
                          {ethics?.name ?? id}
                        </Badge>
                      );
                    })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full h-14 text-lg bg-amber-500 hover:bg-amber-600"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Configurando...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Iniciar a {wizardData.agentName}
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container max-w-2xl mx-auto py-8 px-4">
        {/* Progress */}
        <div className="mb-8 space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Paso {currentStep} de 7</span>
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Reiniciar configuración
            </button>
          </div>
          <Progress value={(currentStep / 7) * 100} className="h-2" />
        </div>

        {/* Step content */}
        {renderStep()}

        {/* Validation error */}
        {stepError && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{stepError}</AlertDescription>
          </Alert>
        )}

        {/* Navigation */}
        {!submitSuccess && (
          <div className="flex justify-between mt-6 pt-6 border-t">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1}
            >
              ← Anterior
            </Button>
            {currentStep < 7 ? (
              <Button
                onClick={handleNext}
                className="bg-amber-500 hover:bg-amber-600"
              >
                Siguiente →
              </Button>
            ) : (
              <div /> /* Spacer */
            )}
          </div>
        )}
      </div>
    </div>
  );
}
