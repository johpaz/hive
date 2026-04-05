import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";
import { useChannels, useVoice } from "@/stores/useGlobalConfigStore";
import type { ConnectedChannel } from "@/types";
import { Settings, AlertCircle, Loader2, CheckCircle2, Eye, EyeOff, QrCode, RefreshCw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import QRCode from "qrcode";

// ─── Voice models ───────────────────────────────────────────────────────────
const STT_MODELS = [
    { id: "whisper-large-v3-turbo", name: "Whisper Large V3 Turbo (Groq)", provider: "groq" },
    { id: "whisper-large-v3", name: "Whisper Large V3 (Groq)", provider: "groq" },
    { id: "distil-whisper-large-v3-en", name: "Distil Whisper V3 EN (Groq)", provider: "groq" },
    { id: "whisper-1", name: "Whisper 1 (OpenAI)", provider: "openai" },
];

const TTS_MODELS = [
    { group: "ElevenLabs", provider: "elevenlabs", models: [
        { id: "eleven_flash_v2_5", name: "Flash v2.5" },
        { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
        { id: "eleven_multilingual_v2", name: "Multilingual v2" },
        { id: "eleven_v3", name: "V3" },
    ]},
    { group: "OpenAI", provider: "openai", models: [
        { id: "tts-1", name: "TTS-1" },
        { id: "tts-1-hd", name: "TTS-1 HD" },
        { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS" },
    ]},
    { group: "Google Gemini", provider: "gemini", models: [
        { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS" },
        { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS" },
    ]},
    { group: "Qwen", provider: "qwen", models: [
        { id: "qwen3-tts-instruct-flash", name: "Qwen3 TTS Instruct Flash" },
        { id: "qwen3-tts-flash", name: "Qwen3 TTS Flash" },
        { id: "qwen-tts", name: "Qwen TTS" },
    ]},
];

function getProviderFromModel(modelId: string): string | null {
    if (modelId.startsWith("eleven")) return "elevenlabs";
    if (modelId.startsWith("tts-") || modelId.startsWith("gpt-")) return "openai";
    if (modelId.startsWith("gemini")) return "gemini";
    if (modelId.startsWith("qwen")) return "qwen";
    return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type Step = "type" | "credentials" | "reconnect" | "qr" | "connecting" | "success" | "settings";

interface ChannelConfigDialogProps {
    channel: ConnectedChannel | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (id: string, data: Partial<ConnectedChannel>) => Promise<void>;
}

// ─── QR Canvas ───────────────────────────────────────────────────────────────
function QRCanvas({ data }: { data: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!data || !canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, data, {
            width: 220,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
        }).catch(console.error);
    }, [data]);

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl overflow-hidden border-4 border-white shadow-lg">
                <canvas ref={canvasRef} />
            </div>
            <p className="text-xs text-white/40 text-center">
                Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo
            </p>
        </div>
    );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────
export function ChannelConfigDialog({ channel, isOpen, onClose, onSave }: ChannelConfigDialogProps) {
    const navigate = useNavigate();
    const { createChannel, reconnectChannel, fetchChannels } = useChannels();
    const { configuredVoiceProviders, fetchConfiguredVoiceProviders } = useVoice();

    // ── new channel wizard state ──────────────────────────────────────────
    const [step, setStep] = useState<Step>(channel ? "settings" : "type");
    const [selectedType, setSelectedType] = useState<string>("telegram");
    const [botToken, setBotToken] = useState("");
    const [appId, setAppId] = useState(""); // discord only
    const [signingSecret, setSigningSecret] = useState(""); // slack only
    const [showSigningSecret, setShowSigningSecret] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [createdChannelId, setCreatedChannelId] = useState<string | null>(null);
    const [qrData, setQrData] = useState<string | null>(null);
    const [qrExpired, setQrExpired] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── edit channel state ────────────────────────────────────────────────
    const [formData, setFormData] = useState<Partial<ConnectedChannel>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingVoices, setLoadingVoices] = useState(false);
    const [showChangeToken, setShowChangeToken] = useState(false);
    const [newToken, setNewToken] = useState("");
    const [showNewToken, setShowNewToken] = useState(false);

    // ── helpers ───────────────────────────────────────────────────────────
    const isDisconnected = channel && channel.status !== "connected";
    const isUnconfigured = channel && channel.isConfigured === false;

    // ── reset on open/close ───────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            if (channel) {
                // Disconnected channels go to reconnect mode; connected go to settings
                setStep(isDisconnected ? "reconnect" : "settings");
                setSelectedType(channel.type);
                setBotToken("");
                setAppId("");
                setSigningSecret("");
                setCreatedChannelId(channel.id);
                setQrData(null);
                setQrExpired(false);
                setConnectError(null);
                setFormData(channel);
                setShowChangeToken(false);
                setNewToken("");
                setShowNewToken(false);
            } else {
                setStep("type");
                setSelectedType("telegram");
                setBotToken("");
                setAppId("");
                setSigningSecret("");
                setCreatedChannelId(null);
                setQrData(null);
                setQrExpired(false);
                setConnectError(null);
            }
        } else {
            stopPoll();
        }
    }, [isOpen, channel]);

    useEffect(() => {
        fetchConfiguredVoiceProviders();
    }, [fetchConfiguredVoiceProviders]);

    // ── voice selector for TTS ────────────────────────────────────────────
    useEffect(() => {
        const provider = formData.tts_provider ? getProviderFromModel(formData.tts_provider) : null;
        if (!provider) { setVoices([]); return; }
        setLoadingVoices(true);
        apiClient<{ voices: Array<{ id: string; name: string }> }>(`/api/voice/${provider}/voices`, { showError: false })
            .then(data => setVoices(data.voices || []))
            .catch(() => setVoices([]))
            .finally(() => setLoadingVoices(false));
    }, [formData.tts_provider]);

    // ─── polling helpers ─────────────────────────────────────────────────
    const stopPoll = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollStatus = useCallback((type: string, id: string) => {
        stopPoll();
        pollRef.current = setInterval(async () => {
            try {
                const data = await apiClient<{ status: string; qrCode?: string }>(
                    `/api/channels/${type}/${id}/status`,
                    { showError: false }
                );

                if (data.status === "qr" && data.qrCode) {
                    setQrData(data.qrCode);
                    setQrExpired(false);
                    setStep("qr");
                } else if (data.status === "connected") {
                    stopPoll();
                    await fetchChannels();
                    setStep("success");
                } else if (data.status === "error") {
                    stopPoll();
                    setConnectError("Error de conexión. Intenta de nuevo.");
                    setStep("credentials");
                } else if (data.status === "disconnected" || data.status === "not_found") {
                    // QR expired — Baileys will auto-reconnect and emit a new QR
                    setQrExpired(true);
                }
            } catch {
                // network error during poll — keep polling
            }
        }, 2000);
    }, [stopPoll, fetchChannels]);

    // ─── handlers ────────────────────────────────────────────────────────
    const handleReconnect = async () => {
        if (!channel) return;
        setIsConnecting(true);
        setConnectError(null);

        try {
            const config: Record<string, unknown> = {};
            if (selectedType === "telegram" && botToken.trim()) config.botToken = botToken;
            if (selectedType === "discord") {
                if (botToken.trim()) config.botToken = botToken;
                if (appId.trim()) config.applicationId = appId;
            }

            await reconnectChannel(channel.id, Object.keys(config).length > 0 ? config : undefined);
            setStep("connecting");
            pollStatus(selectedType, channel.id);
        } catch (err) {
            setConnectError((err as Error).message || "Error al reconectar");
        } finally {
            setIsConnecting(false);
        }
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setConnectError(null);

        try {
            const config: Record<string, unknown> = {};
            if (selectedType === "telegram") config.botToken = botToken;
            if (selectedType === "discord") { config.botToken = botToken; config.applicationId = appId; }
            if (selectedType === "slack") { config.botToken = botToken; config.signingSecret = signingSecret; }

            const { id } = await createChannel(selectedType, config);
            setCreatedChannelId(id);

            if (selectedType === "whatsapp") {
                setStep("connecting");
                pollStatus("whatsapp", id);
            } else {
                // telegram / discord / webchat → poll briefly then show success
                setStep("connecting");
                pollStatus(selectedType, id);
            }
        } catch (err) {
            setConnectError((err as Error).message || "Error al conectar");
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSaveSettings = async () => {
        if (!channel?.id) return;
        setIsSaving(true);
        try {
            // If a new token was entered, reconnect with it first
            if (newToken.trim().length > 10 && (channel.type === "telegram" || channel.type === "discord")) {
                const config: Record<string, unknown> = { botToken: newToken.trim() };
                await reconnectChannel(channel.id, config);
            }
            await onSave(channel.id, formData);
            onClose();
        } catch (error) {
            console.error("Save failed", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleClose = () => {
        stopPoll();
        onClose();
    };

    const canConnect =
        selectedType === "whatsapp" ||
        selectedType === "webchat" ||
        (selectedType === "telegram" && botToken.trim().length > 10) ||
        (selectedType === "discord" && botToken.trim().length > 10 && appId.trim().length > 0) ||
        (selectedType === "slack" && botToken.trim().length > 10 && signingSecret.trim().length > 10);

    // ─── render steps ─────────────────────────────────────────────────────
    const renderNewChannelContent = () => {
        if (step === "reconnect") {
            const needsCreds = isUnconfigured && (selectedType === "telegram" || selectedType === "discord");
            return (
                <div className="space-y-4 py-2">
                    {connectError && (
                        <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{connectError}</AlertDescription>
                        </Alert>
                    )}

                    <div className={`p-4 rounded-xl ${isUnconfigured ? "bg-blue-500/10 border border-blue-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
                        <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${isUnconfigured ? "text-blue-300" : "text-amber-300"}`}>
                            {isUnconfigured ? "Canal no configurado" : "Canal desconectado"}
                        </p>
                        <p className={`text-xs ${isUnconfigured ? "text-blue-200/70" : "text-amber-200/70"}`}>
                            {isUnconfigured
                                ? selectedType === "whatsapp"
                                    ? "Haz clic en Conectar para generar el código QR."
                                    : selectedType === "webchat"
                                        ? "Haz clic en Conectar para activar el canal web."
                                        : "Ingresa las credenciales para activar este canal."
                                : selectedType === "whatsapp"
                                    ? "Haz clic en Reconectar para generar un nuevo código QR."
                                    : selectedType === "webchat"
                                        ? "Haz clic en Reconectar para activar el canal."
                                        : "Puedes reconectar con las credenciales existentes o ingresar un nuevo token."}
                        </p>
                    </div>

                    {(selectedType === "telegram" || selectedType === "discord") && (
                        <div className="space-y-3">
                            <p className="text-[10px] text-white/30 uppercase tracking-widest">
                                {isUnconfigured ? "Credenciales" : "Actualizar credenciales (opcional)"}
                            </p>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-white/50">Bot Token</Label>
                                <div className="relative">
                                    <Input
                                        type={showToken ? "text" : "password"}
                                        value={botToken}
                                        onChange={e => setBotToken(e.target.value)}
                                        placeholder={isUnconfigured
                                            ? (selectedType === "telegram" ? "123456789:AAF..." : "MTA5NDY...")
                                            : "Dejar vacío para usar el token actual"}
                                        className="bg-white/5 border-white/10 pr-10 font-mono text-sm"
                                    />
                                    <button type="button" onClick={() => setShowToken(v => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                            {selectedType === "discord" && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-white/50">Application ID</Label>
                                    <Input value={appId} onChange={e => setAppId(e.target.value)}
                                        placeholder={isUnconfigured ? "123456789012345678" : "Dejar vacío para usar el actual"}
                                        className="bg-white/5 border-white/10 font-mono text-sm" />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (step === "type") {
            return (
                <div className="space-y-4 py-2">
                    <p className="text-sm text-white/50">Selecciona el tipo de canal a conectar:</p>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { id: "telegram", label: "Telegram", icon: "✈️" },
                            { id: "whatsapp", label: "WhatsApp", icon: "💬" },
                            { id: "discord", label: "Discord", icon: "🎮" },
                            { id: "slack", label: "Slack", icon: "💼" },
                            { id: "webchat", label: "WebChat", icon: "🌐" },
                        ].map(t => (
                            <button
                                key={t.id}
                                onClick={() => setSelectedType(t.id)}
                                className={`p-4 rounded-xl border text-left transition-all duration-200 ${selectedType === t.id
                                    ? "border-blue-500 bg-blue-500/10 text-white"
                                    : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/70"
                                }`}
                            >
                                <div className="text-2xl mb-1">{t.icon}</div>
                                <div className="text-sm font-semibold">{t.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
            );
        }

        if (step === "credentials") {
            return (
                <div className="space-y-4 py-2">
                    {connectError && (
                        <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{connectError}</AlertDescription>
                        </Alert>
                    )}

                    {selectedType === "whatsapp" && (
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
                            WhatsApp no requiere token. Haz clic en "Conectar" y escanea el código QR con tu teléfono.
                        </div>
                    )}

                    {selectedType === "webchat" && (
                        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
                            WebChat no requiere configuración. Haz clic en "Conectar" para activarlo.
                        </div>
                    )}

                    {(selectedType === "telegram" || selectedType === "discord" || selectedType === "slack") && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-white/50 uppercase tracking-widest">Bot Token</Label>
                                <div className="relative">
                                    <Input
                                        type={showToken ? "text" : "password"}
                                        value={botToken}
                                        onChange={e => setBotToken(e.target.value)}
                                        placeholder={
                                            selectedType === "telegram" ? "123456789:AAF..." :
                                            selectedType === "slack" ? "xoxb-..." :
                                            "MTA5NDY..."
                                        }
                                        className="bg-white/5 border-white/10 pr-10 font-mono text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowToken(v => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                                    >
                                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {selectedType === "discord" && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-white/50 uppercase tracking-widest">Application ID</Label>
                                    <Input
                                        value={appId}
                                        onChange={e => setAppId(e.target.value)}
                                        placeholder="123456789012345678"
                                        className="bg-white/5 border-white/10 font-mono text-sm"
                                    />
                                </div>
                            )}

                            {selectedType === "slack" && (
                                <>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-white/50 uppercase tracking-widest">Signing Secret</Label>
                                        <div className="relative">
                                            <Input
                                                type={showSigningSecret ? "text" : "password"}
                                                value={signingSecret}
                                                onChange={e => setSigningSecret(e.target.value)}
                                                placeholder="a1b2c3d4e5f6..."
                                                className="bg-white/5 border-white/10 pr-10 font-mono text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowSigningSecret(v => !v)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                                            >
                                                {showSigningSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/80">
                                        Slack requiere una URL pública para webhooks. Usa ngrok, cloudflared o Tailscale y configura la Request URL en tu Slack App: <span className="font-mono">https://tu-url/slack/events</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (step === "connecting") {
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    <div className="relative">
                        <div className="h-16 w-16 rounded-full border-2 border-white/10 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                        </div>
                    </div>
                    <p className="text-sm text-white/60 text-center">
                        {selectedType === "whatsapp"
                            ? "Iniciando WhatsApp... Generando código QR"
                            : "Conectando canal..."}
                    </p>
                    <p className="text-xs text-white/30">Esto puede tardar unos segundos</p>
                </div>
            );
        }

        if (step === "qr") {
            return (
                <div className="flex flex-col items-center gap-4 py-4">
                    <div className="relative">
                        {qrData ? (
                            <QRCanvas data={qrData} />
                        ) : (
                            <div className="flex flex-col items-center gap-3 py-6">
                                <QrCode className="h-16 w-16 text-white/20" />
                                <p className="text-xs text-white/40">Generando QR...</p>
                            </div>
                        )}
                        {qrExpired && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-zinc-950/80 backdrop-blur-sm gap-2">
                                <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                                <p className="text-xs text-amber-300 font-medium">QR expirado, renovando...</p>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/30">
                        {qrExpired ? (
                            <>
                                <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                                Renovando código QR...
                            </>
                        ) : (
                            <>
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Esperando escaneo...
                            </>
                        )}
                    </div>
                    <p className="text-[11px] text-white/30 text-center">
                        Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo
                    </p>
                </div>
            );
        }

        if (step === "success") {
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    <div className="h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-semibold text-white">Canal conectado</p>
                        <p className="text-xs text-white/40 mt-1">
                            {selectedType.charAt(0).toUpperCase() + selectedType.slice(1)} está activo y listo para recibir mensajes.
                        </p>
                    </div>
                </div>
            );
        }

        return null;
    };

    const renderSettingsContent = () => (
        <div className="grid gap-4 py-4">
            {/* Token section for Telegram / Discord */}
            {(channel?.type === "telegram" || channel?.type === "discord") && (
                <div className="space-y-2 pb-2 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs text-white/50 uppercase tracking-widest">Bot Token</Label>
                        {!showChangeToken && (
                            <button
                                type="button"
                                onClick={() => setShowChangeToken(true)}
                                className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                Cambiar token
                            </button>
                        )}
                    </div>
                    {!showChangeToken ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                            <span className="font-mono text-sm text-white/30 tracking-widest select-none">
                                ••••••••••••••••••••••••
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="relative">
                                <Input
                                    type={showNewToken ? "text" : "password"}
                                    value={newToken}
                                    onChange={e => setNewToken(e.target.value)}
                                    placeholder={channel?.type === "telegram" ? "123456789:AAF..." : "MTA5NDY..."}
                                    className="bg-white/5 border-white/10 pr-10 font-mono text-sm"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewToken(v => !v)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                                >
                                    {showNewToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setShowChangeToken(false); setNewToken(""); setShowNewToken(false); }}
                                    className="text-[11px] text-white/40 hover:text-white/60 transition-colors"
                                >
                                    Cancelar
                                </button>
                                {newToken.trim().length > 0 && (
                                    <span className="text-[11px] text-amber-400/70">
                                        Se aplicará al guardar
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right text-xs">Voz (STT)</Label>
                <div className="flex items-center gap-2 col-span-3">
                    <Switch
                        checked={formData.voice_enabled}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, voice_enabled: v }))}
                    />
                    <span className="text-xs text-muted-foreground">Procesar notas de voz</span>
                </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right text-xs">TTS</Label>
                <div className="flex items-center gap-2 col-span-3">
                    <Switch
                        checked={formData.tts_enabled}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, tts_enabled: v }))}
                    />
                    <span className="text-xs text-muted-foreground">Responder por voz</span>
                </div>
            </div>

            {formData.voice_enabled && (
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right text-xs">Modelo STT</Label>
                    <Select value={formData.stt_provider || ""} onValueChange={v => setFormData(p => ({ ...p, stt_provider: v }))}>
                        <SelectTrigger className="col-span-3">
                            <SelectValue placeholder="Selecciona modelo STT" />
                        </SelectTrigger>
                        <SelectContent>
                            {STT_MODELS.filter(m => configuredVoiceProviders[m.provider]).map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {formData.tts_enabled && (
                <>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right text-xs">Modelo TTS</Label>
                        <Select value={formData.tts_provider || ""} onValueChange={v => setFormData(p => ({ ...p, tts_provider: v, tts_voice_id: "" }))}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Selecciona modelo TTS" />
                            </SelectTrigger>
                            <SelectContent>
                                {TTS_MODELS.filter(g => configuredVoiceProviders[g.provider]).map(group => (
                                    <SelectGroup key={group.group}>
                                        <SelectLabel>{group.group}</SelectLabel>
                                        {group.models.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                                    </SelectGroup>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.tts_provider && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right text-xs">Voz</Label>
                            <Select
                                value={formData.tts_voice_id || ""}
                                onValueChange={v => setFormData(p => ({ ...p, tts_voice_id: v }))}
                                disabled={loadingVoices || voices.length === 0}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder={loadingVoices ? "Cargando..." : "Selecciona una voz"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {voices.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!configuredVoiceProviders.elevenlabs && !configuredVoiceProviders.openai && !configuredVoiceProviders.gemini && !configuredVoiceProviders.qwen && (
                        <Alert variant="destructive" className="bg-yellow-500/10 border-yellow-500/30 text-yellow-200">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="text-yellow-200/80">
                                Configura un provider TTS.{" "}
                                <button className="underline" onClick={() => { onClose(); navigate("/settings/voz"); }}>
                                    Ir a Configuración de Voz
                                </button>
                            </AlertDescription>
                        </Alert>
                    )}
                </>
            )}

            <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right text-xs">Entrega</Label>
                <Select value={formData.step_delivery_mode} onValueChange={v => setFormData(p => ({ ...p, step_delivery_mode: v }))}>
                    <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Modo de entrega" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="new_messages">Solo Mensajes Nuevos</SelectItem>
                        <SelectItem value="all">Todo (Sincronización)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );

    // ─── footer buttons by step ───────────────────────────────────────────
    const canReconnect =
        selectedType === "whatsapp" ||
        selectedType === "webchat" ||
        !isUnconfigured ||
        (selectedType === "telegram" && botToken.trim().length > 10) ||
        (selectedType === "discord" && botToken.trim().length > 10 && appId.trim().length > 0);

    const renderFooter = () => {
        if (channel && step === "settings") {
            return (
                <>
                    <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancelar</Button>
                    <Button onClick={handleSaveSettings} disabled={isSaving}>
                        {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</> : "Guardar Cambios"}
                    </Button>
                </>
            );
        }

        if (step === "reconnect") {
            return (
                <>
                    <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                    <Button onClick={handleReconnect} disabled={isConnecting || !canReconnect}>
                        {isConnecting
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Conectando...</>
                            : isUnconfigured ? "Conectar" : "Reconectar"}
                    </Button>
                </>
            );
        }

        if (step === "type") {
            return (
                <>
                    <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                    <Button onClick={() => setStep("credentials")}>Siguiente →</Button>
                </>
            );
        }

        if (step === "credentials") {
            return (
                <>
                    <Button variant="outline" onClick={() => setStep("type")}>← Atrás</Button>
                    <Button onClick={handleConnect} disabled={isConnecting || !canConnect}>
                        {isConnecting
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Conectando...</>
                            : "Conectar"}
                    </Button>
                </>
            );
        }

        if (step === "connecting") {
            return <Button variant="outline" onClick={handleClose}>Cancelar</Button>;
        }

        if (step === "qr") {
            return (
                <>
                    <Button variant="outline" size="sm" onClick={() => {
                        if (createdChannelId) pollStatus(selectedType, createdChannelId);
                    }}>
                        <RefreshCw className="h-3.5 w-3.5 mr-2" />
                        Actualizar QR
                    </Button>
                    <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                </>
            );
        }

        if (step === "success") {
            return <Button onClick={handleClose}>Cerrar</Button>;
        }

        return null;
    };

    // ─── title by step ────────────────────────────────────────────────────
    const getTitle = () => {
        const titles: Record<Step, string> = {
            type: "Nuevo Canal",
            credentials: `Conectar ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}`,
            reconnect: isUnconfigured
                ? `Configurar ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}`
                : `Reconectar ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}`,
            connecting: "Conectando...",
            qr: "Escanea el código QR",
            success: "¡Canal conectado!",
            settings: `Configurar ${channel?.type ?? "canal"}`,
        };
        return titles[step] ?? "Nuevo Canal";
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
            onClick={handleClose}
        >
            <div
                className="relative w-full max-w-[480px] mx-4 hive-card border-white/10 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={handleClose}
                    className="absolute right-4 top-4 z-10 text-white/40 hover:text-white transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>

                {/* Header with glow */}
                <div className="p-6 border-b border-white/5 bg-white/5 relative overflow-hidden">
                    <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-20" />
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter relative z-10 flex items-center gap-2">
                        <Settings className="h-4 w-4 text-blue-400" />
                        {getTitle()}
                    </h2>
                    <p className="text-xs text-white/40 font-medium mt-1 relative z-10">
                        {step === "settings"
                            ? "Ajusta el comportamiento y las opciones de voz del canal."
                            : step === "qr"
                                ? "Abre WhatsApp en tu teléfono y escanea el código para vincular el dispositivo."
                                : step === "reconnect"
                                    ? isUnconfigured
                                        ? "Ingresa las credenciales para activar este canal."
                                        : "Reconecta el canal con las credenciales existentes o actualízalas."
                                    : "Conecta un nuevo canal de comunicación a Hive."}
                    </p>
                </div>

                {/* Content */}
                <div className="p-6">
                    {channel && step === "settings" ? renderSettingsContent() : renderNewChannelContent()}
                </div>

                {/* Footer */}
                <div className="p-6 pt-4 flex gap-2">
                    {renderFooter()}
                </div>
            </div>
        </div>
    );
}
