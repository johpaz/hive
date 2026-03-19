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
import { CheckCircle2, XCircle, Sparkles, Hexagon, Volume2, VolumeX } from "lucide-react";
import { useLoaderStore } from "@/stores/useLoaderStore";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { swal } from "@/lib/swal";

const PROVIDERS = [
  { id: "gemini",     name: "Google Gemini",  description: "Modelos rápidos y económicos de Google", logo: "🔵" },
  { id: "anthropic",  name: "Anthropic",       description: "Claude — mejor equilibrio para coding", logo: "🟠" },
  { id: "openai",     name: "OpenAI",          description: "GPT-5 — el estándar de la industria",  logo: "🟢" },
  { id: "groq",       name: "Groq",            description: "Inferencia ultra-rápida",              logo: "🔴" },
  { id: "ollama",     name: "Ollama",          description: "Modelos locales — sin costo",          logo: "🟣" },
  { id: "openrouter", name: "OpenRouter",      description: "Multi-proveedor — unifica tus keys",   logo: "🟡" },
  { id: "deepseek",   name: "DeepSeek",        description: "Modelos de alta calidad y bajo costo", logo: "🔷" },
  { id: "mistral",    name: "Mistral AI",      description: "Modelos europeos open-weight",         logo: "🔸" },
  { id: "kimi",       name: "Kimi (Moonshot)", description: "Contexto largo, ideal para código",    logo: "🌙" },
];

const CHANNELS = [
  { id: "webchat", name: "WebChat", description: "Chat web integrado", icon: "💬", required: true },
  { id: "telegram", name: "Telegram", description: "Bot de Telegram", icon: "✈️", required: false },
  { id: "discord", name: "Discord", description: "Bot de Discord", icon: "🎮", required: false },
  { id: "whatsapp", name: "WhatsApp", description: "Bot de WhatsApp", icon: "📱", required: false },
  { id: "slack", name: "Slack", description: "Bot de Slack", icon: "💼", required: false },
];

const ETHICS_RULES = [
  { id: "no-harm", category: "NUNCA", description: "No causar daño físico o emocional a personas" },
  { id: "no-illegal", category: "NUNCA", description: "No facilitar actividades ilegales o peligrosas" },
  { id: "no-deception", category: "NUNCA", description: "No engañar o manipular deliberadamente" },
  { id: "privacy-first", category: "SIEMPRE", description: "Proteger la privacidad del usuario" },
  { id: "transparency", category: "SIEMPRE", description: "Ser transparente sobre limitaciones" },
  { id: "confirm-destructive", category: "CONFIRMAR", description: "Confirmar antes de acciones destructivas" },
  { id: "confirm-expensive", category: "CONFIRMAR", description: "Confirmar antes de operaciones costosas" },
];

const AVATARS = [
  { id: "amber", color: "bg-amber-500", hex: "#f59e0b" },
  { id: "blue", color: "bg-blue-500", hex: "#3b82f6" },
  { id: "green", color: "bg-green-500", hex: "#22c55e" },
  { id: "purple", color: "bg-purple-500", hex: "#a855f7" },
  { id: "red", color: "bg-red-500", hex: "#ef4444" },
  { id: "cyan", color: "bg-cyan-500", hex: "#06b6d4" },
];

interface WizardData {
  // Step 1
  userName: string;
  userLanguage: string;
  userTimezone: string;
  // Step 2
  agentName: string;
  agentDescription: string;
  agentAvatar: string;
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
  ethicsRules: Record<string, { enabled: boolean; category: string }>;
  customRules: Array<{ text: string; category: string }>;
}

const STORAGE_KEY = "hive_setup_wizard_data";

function loadWizardData(): WizardData | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
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
    agentName: "Bee",
    agentDescription: "",
    agentAvatar: "amber",
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
    ethicsRules: Object.fromEntries(
      ETHICS_RULES.map(rule => [rule.id, { enabled: true, category: rule.category }])
    ),
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

  useEffect(() => {
    saveWizardData(wizardData);
  }, [wizardData]);

  useEffect(() => {
    // Check if already configured
    fetch("/api/setup/status")
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
    setWizardData(prev => ({ ...prev, ...updates }));
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return wizardData.userName.trim().length >= 2;
      case 2:
        return wizardData.agentName.trim().length >= 2;
      case 3:
        return wizardData.provider !== "" && wizardData.apiKeyVerified;
      case 4:
        return true; // WebChat is always enabled
      case 5:
        return true; // Voice is optional
      case 6:
        return true; // At least one rule should be enabled (default)
      case 7:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (canProceed() && currentStep < 7) {
      setCurrentStep(prev => prev + 1);
    }
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
          model: wizardData.model || "test",
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
        if (result.authToken) {
          localStorage.setItem("hive-auth-token", result.authToken);
        }
        setSubmitSuccess(true);
        clearWizardData();
        // Server restarts after setup — poll until it's back, then redirect
        const waitForRestart = async () => {
          await new Promise(r => setTimeout(r, 1500)); // wait for restart to begin
          showLoader(`Iniciando a ${wizardData.agentName}... esto toma unos segundos`);
          for (let i = 0; i < 30; i++) {
            try {
              const res = await fetch("/health");
              if (res.ok) { hideLoader(); navigate("/"); return; }
            } catch { /* server still restarting */ }
            await new Promise(r => setTimeout(r, 1000));
          }
          hideLoader();
          navigate("/"); // fallback after 30s
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

          <div className="space-y-2">
            <Label>Avatar del agente</Label>
            <div className="flex gap-3 flex-wrap">
              {AVATARS.map((avatar) => (
                <button
                  key={avatar.id}
                  className={cn(
                    "w-12 h-12 rounded-lg flex items-center justify-center transition-all",
                    avatar.color,
                    wizardData.agentAvatar === avatar.id
                      ? "ring-2 ring-offset-2 ring-amber-500 scale-110"
                      : "hover:scale-105"
                  )}
                  onClick={() => updateData({ agentAvatar: avatar.id })}
                >
                  <Hexagon className="w-6 h-6 text-white" fill="currentColor" />
                </button>
              ))}
            </div>
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
        {PROVIDERS.map((provider) => (
          <Card
            key={provider.id}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              wizardData.provider === provider.id && "border-amber-500 ring-2 ring-amber-500"
            )}
            onClick={() => updateData({ provider: provider.id, apiKeyVerified: false })}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <span className="text-3xl">{provider.logo}</span>
              <div className="flex-1">
                <h3 className="font-semibold">{provider.name}</h3>
                <p className="text-sm text-muted-foreground">{provider.description}</p>
              </div>
              {wizardData.provider === provider.id && (
                <CheckCircle2 className="w-5 h-5 text-amber-500" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {wizardData.provider && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Configuración de {PROVIDERS.find(p => p.id === wizardData.provider)?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type="password"
                  value={wizardData.apiKey}
                  onChange={(e) => updateData({ apiKey: e.target.value, apiKeyVerified: false })}
                  placeholder={wizardData.provider === "ollama" ? "No requerida" : "sk-..."}
                  disabled={wizardData.provider === "ollama"}
                />
                {wizardData.provider !== "ollama" && (
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
                )}
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
              {wizardData.provider !== "ollama" && (
                <p className="text-xs text-muted-foreground">
                  ¿No tienes tu API key?{" "}
                  <a
                    href={
                      {
                        gemini: "https://aistudio.google.com/app/apikey",
                        anthropic: "https://console.anthropic.com/keys",
                        openai: "https://platform.openai.com/api-keys",
                        groq: "https://console.groq.com/keys",
                        openrouter: "https://openrouter.ai/keys",
                        deepseek: "https://platform.deepseek.com/api_keys",
                        mistral: "https://console.mistral.ai/api-keys",
                        kimi: "https://platform.moonshot.cn/console/api-keys",
                      }[wizardData.provider] || "#"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-500 hover:underline"
                  >
                    Obtener aquí
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Select
                value={wizardData.model}
                onValueChange={(value) => updateData({ model: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un modelo" />
                </SelectTrigger>
                <SelectContent>
                  {wizardData.provider === "gemini" && (
                    <>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (Recomendado)</SelectItem>
                      <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                      <SelectItem value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "anthropic" && (
                    <>
                      <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (Recomendado)</SelectItem>
                      <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                      <SelectItem value="claude-haiku-4-6">Claude Haiku 4.6</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "openai" && (
                    <>
                      <SelectItem value="gpt-5.2">GPT-5.2 (Recomendado)</SelectItem>
                      <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                      <SelectItem value="o4-mini">o4-mini</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "groq" && (
                    <>
                      <SelectItem value="llama-3.3-70b-versatile">Llama 3.3 70B (Recomendado)</SelectItem>
                      <SelectItem value="mixtral-8x7b-32768">Mixtral 8x7B</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "ollama" && (
                    <>
                      <SelectItem value="llama3.3:8b">Llama 3.3 8B (Recomendado)</SelectItem>
                      <SelectItem value="qwen2.5:7b">Qwen 2.5 7B</SelectItem>
                      <SelectItem value="mistral:7b">Mistral 7B</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "openrouter" && (
                    <>
                      <SelectItem value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B (Gratis)</SelectItem>
                      <SelectItem value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Gratis)</SelectItem>
                      <SelectItem value="anthropic/claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "deepseek" && (
                    <>
                      <SelectItem value="deepseek-chat">DeepSeek Chat (Recomendado)</SelectItem>
                      <SelectItem value="deepseek-coder">DeepSeek Coder</SelectItem>
                      <SelectItem value="deepseek-reasoner">DeepSeek Reasoner (R1)</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "mistral" && (
                    <>
                      <SelectItem value="mistral-small-latest">Mistral Small (Recomendado)</SelectItem>
                      <SelectItem value="mistral-large-latest">Mistral Large</SelectItem>
                      <SelectItem value="codestral-latest">Codestral</SelectItem>
                    </>
                  )}
                  {wizardData.provider === "kimi" && (
                    <>
                      <SelectItem value="moonshot-v1-8k">Moonshot v1 8K (Recomendado)</SelectItem>
                      <SelectItem value="moonshot-v1-32k">Moonshot v1 32K</SelectItem>
                      <SelectItem value="moonshot-v1-128k">Moonshot v1 128K</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}
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
        {ETHICS_RULES.map((rule) => {
          const ruleState = wizardData.ethicsRules[rule.id];
          const categoryColor = {
            NUNCA: "text-red-500 bg-red-500/10",
            SIEMPRE: "text-green-500 bg-green-500/10",
            CONFIRMAR: "text-amber-500 bg-amber-500/10",
          }[rule.category];

          return (
            <Card key={rule.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={ruleState?.enabled}
                      onCheckedChange={(checked) => {
                        if (rule.category === "NUNCA" && !checked) {
                          if (!confirm("¿Estás seguro de desactivar esta regla de protección?")) {
                            return;
                          }
                        }
                        updateData({
                          ethicsRules: {
                            ...wizardData.ethicsRules,
                            [rule.id]: { ...ruleState, enabled: checked as boolean },
                          },
                        });
                      }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{rule.description}</h3>
                        <Badge className={cn("text-xs", categoryColor)}>
                          {rule.category}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        ID: {rule.id}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
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
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  AVATARS.find(a => a.id === wizardData.agentAvatar)?.color
                )}>
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
                  {PROVIDERS.find(p => p.id === wizardData.provider)?.name || wizardData.provider} — {wizardData.model}
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
                    .filter(([_, data]) => data.enabled)
                    .map(([id]) => {
                      const rule = ETHICS_RULES.find(r => r.id === id);
                      return (
                        <Badge key={id} variant="outline">
                          {rule?.description.substring(0, 30)}...
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

        {/* Navigation */}
        {!submitSuccess && (
          <div className="flex justify-between mt-8 pt-8 border-t">
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
                disabled={!canProceed()}
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
