import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import type { ConnectedChannel } from "@/types";

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

interface ChannelConfigDialogProps {
    channel: ConnectedChannel | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (id: string, data: Partial<ConnectedChannel>) => Promise<void>;
}

export function ChannelConfigDialog({
    channel,
    isOpen,
    onClose,
    onSave,
}: ChannelConfigDialogProps) {
    const [formData, setFormData] = useState<Partial<ConnectedChannel>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingVoices, setLoadingVoices] = useState(false);
    const [configuredProviders, setConfiguredProviders] = useState<Record<string, boolean>>({});

    useEffect(() => {
        apiClient<Record<string, boolean>>("/api/voice/configured-providers", { showError: false })
            .then(setConfiguredProviders)
            .catch(() => setConfiguredProviders({}));
    }, []);

    useEffect(() => {
        if (channel) {
            setFormData(channel);
        } else {
            setFormData({
                type: "telegram",
                enabled: true,
                active: false,
                voice_enabled: false,
                tts_enabled: false,
            } as any);
        }
    }, [channel]);

    useEffect(() => {
        const provider = formData.tts_provider ? getProviderFromModel(formData.tts_provider) : null;
        if (!provider) {
            setVoices([]);
            return;
        }
        setLoadingVoices(true);
        apiClient<{ voices: Array<{ id: string; name: string }> }>(`/api/voice/${provider}/voices`, { showError: false })
            .then(data => setVoices(data.voices || []))
            .catch(() => setVoices([]))
            .finally(() => setLoadingVoices(false));
    }, [formData.tts_provider]);

    const handleSave = async () => {
        if (!channel?.id && !formData.type) return;

        setIsSaving(true);
        try {
            await onSave(channel?.id || "new", formData);
            onClose();
        } catch (error) {
            console.error("Save failed", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>
                        {channel ? `Configurar ${channel.type}` : "Añadir Nuevo Canal"}
                    </DialogTitle>
                    <DialogDescription>
                        Ajusta las credenciales y el comportamiento del canal.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">Tipo</Label>
                        <Select
                            disabled={!!channel}
                            value={formData.type}
                            onValueChange={(v) => setFormData(prev => ({ ...prev, type: v as any }))}
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Selecciona un tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="telegram">Telegram</SelectItem>
                                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                <SelectItem value="discord">Discord</SelectItem>
                                <SelectItem value="webchat">WebChat</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Voz</Label>
                        <div className="flex items-center gap-2 col-span-3">
                            <Switch
                                checked={formData.voice_enabled}
                                onCheckedChange={(v) => setFormData(prev => ({ ...prev, voice_enabled: v }))}
                            />
                            <span className="text-xs text-muted-foreground text-pretty">
                                Habilitar procesamiento de notas de voz (STT)
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">TTS</Label>
                        <div className="flex items-center gap-2 col-span-3">
                            <Switch
                                checked={formData.tts_enabled}
                                onCheckedChange={(v) => setFormData(prev => ({ ...prev, tts_enabled: v }))}
                            />
                            <span className="text-xs text-muted-foreground">
                                Habilitar respuesta por voz (Text-to-Speech)
                            </span>
                        </div>
                    </div>

                    {formData.voice_enabled && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Modelo STT</Label>
                            <Select
                                value={formData.stt_provider || ""}
                                onValueChange={(v) => setFormData(prev => ({ ...prev, stt_provider: v }))}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Selecciona modelo STT" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STT_MODELS.filter(m => configuredProviders[m.provider]).map(m => (
                                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {formData.tts_enabled && (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Modelo TTS</Label>
                                <Select
                                    value={formData.tts_provider || ""}
                                    onValueChange={(v) => setFormData(prev => ({ ...prev, tts_provider: v, tts_voice_id: "" }))}
                                >
                                    <SelectTrigger className="col-span-3">
                                        <SelectValue placeholder="Selecciona modelo TTS" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TTS_MODELS.filter(g => configuredProviders[g.provider]).map(group => (
                                            <SelectGroup key={group.group}>
                                                <SelectLabel>{group.group}</SelectLabel>
                                                {group.models.map(m => (
                                                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                                ))}
                                            </SelectGroup>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {formData.tts_provider && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Voz</Label>
                                    <Select
                                        value={formData.tts_voice_id || ""}
                                        onValueChange={(v) => setFormData(prev => ({ ...prev, tts_voice_id: v }))}
                                        disabled={loadingVoices || voices.length === 0}
                                    >
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue placeholder={loadingVoices ? "Cargando voces..." : "Selecciona una voz"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {voices.map(v => (
                                                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </>
                    )}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="delivery" className="text-right">Entrega</Label>
                        <Select
                            value={formData.step_delivery_mode}
                            onValueChange={(v) => setFormData(prev => ({ ...prev, step_delivery_mode: v }))}
                        >
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

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isSaving}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? "Guardando..." : "Guardar Cambios"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
