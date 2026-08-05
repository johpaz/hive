import { col } from "../storage/hive";
import type { ChannelDoc, ModelDoc } from "../storage/collections";
import { loadProviderApiKey } from "../storage/crypto";
import { wireModelId } from "../storage/model-id";
import { logger } from "../utils/logger";

export interface VoiceConfig {
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  sttProvider: string | null;
  ttsProvider: string | null;
  ttsVoiceId: string | null;
}

export interface AudioInput {
  type: "buffer" | "url" | "base64";
  data: Buffer | string;
  mimeType?: string;
}

export interface AudioOutput {
  type: "buffer" | "base64";
  data: Buffer | string;
  mimeType: string;
}

const log = logger.child("voice");

/**
 * Limpia texto para síntesis de voz (TTS)
 * Elimina formato Markdown, emojis y otros elementos que no se pronuncian bien
 */
export function cleanTextForTTS(text: string): string {
  if (!text) return "";
  
  return text
    // Eliminar código en bloque (``` ... ```)
    .replace(/```[\s\S]*?```/g, " ")
    // Eliminar código inline (`texto`)
    .replace(/`([^`]+)`/g, "$1")
    // Eliminar enlaces [texto](url) → texto
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Eliminar imágenes ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Eliminar negritas **texto** → texto
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    // Eliminar cursivas *texto* o _texto_ → texto
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Eliminar tachado ~~texto~~ → texto
    .replace(/~~([^~]+)~~/g, "$1")
    // Eliminar negritas/cursivas combinadas ***texto*** → texto
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    // Eliminar encabezados # texto → texto
    .replace(/^#+\s+/gm, "")
    // Eliminar listas con guión - texto → texto
    .replace(/^[\-\*]\s+/gm, "")
    // Eliminar listas numeradas 1. texto → texto
    .replace(/^\d+\.\s+/gm, "")
    // Eliminar citas > texto → texto
    .replace(/^>\s+/gm, "")
    // Eliminar emojis (rangos Unicode de emojis)
    .replace(/[\p{Emoji}]/gu, "")
    // Eliminar caracteres de control Unicode
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Eliminar espacios múltiples
    .replace(/\s+/g, " ")
    // Trim final
    .trim();
}

class VoiceService {
  private static instance: VoiceService;

  private constructor() {}

  static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  async getChannelVoiceConfig(channelId: string): Promise<VoiceConfig> {
    const channelsCol = await col<ChannelDoc>("channels");
    const entry = await channelsCol.get(channelId);

    if (!entry) {
      return {
        voiceEnabled: false,
        ttsEnabled: false,
        sttProvider: null,
        ttsProvider: null,
        ttsVoiceId: null,
      };
    }

    return {
      voiceEnabled: entry.doc.voice_enabled,
      ttsEnabled: entry.doc.tts_enabled,
      sttProvider: entry.doc.stt_provider,
      ttsProvider: entry.doc.tts_provider,
      ttsVoiceId: entry.doc.tts_voice_id,
    };
  }

  /**
   * Resuelve lo que el canal tiene guardado en `stt_provider`/`tts_provider` a un
   * par (provider, modelo del catálogo).
   *
   * El campo se llama `*_provider` por historia: hoy guarda el id de un **modelo**,
   * pero las configuraciones viejas guardaban el id del **provider**. En ese caso
   * hay que elegir un modelo concreto acá; devolver sólo el provider hacía que su
   * nombre terminara viajando al cable como si fuera un nombre de modelo.
   */
  private async resolveVoiceModel(
    stored: string,
    type: "stt" | "tts",
  ): Promise<{ provider: string; modelId: string } | null> {
    try {
      const modelsCol = await col<ModelDoc>("models");
      const model = await modelsCol.get(stored);
      if (model?.doc.provider_id) return { provider: model.doc.provider_id, modelId: model.doc.id };

      const providersCol = await col<import("../storage/collections").ProviderDoc>("providers");
      const provider = await providersCol.get(stored);
      if (!provider?.doc.id) return null;

      const candidates = (await modelsCol.findBy("model_type", type))
        .filter((e) => e.doc.provider_id === provider.doc.id && e.doc.enabled);
      const pick = candidates.find((e) => e.doc.active) ?? candidates[0];
      if (!pick) return null;

      log.warn(
        `Canal con ${type}_provider="${stored}" (id de provider, formato viejo): usando ${pick.doc.id}`,
      );
      return { provider: provider.doc.id, modelId: pick.doc.id };
    } catch {
      return null;
    }
  }

  /** Primer modelo STT/TTS activo de un provider activo, como fallback desde la BD. */
  private async getFirstActiveVoiceModel(type: "stt" | "tts"): Promise<{ id: string; provider: string } | null> {
    try {
      const modelsCol = await col<ModelDoc>("models");
      const providersCol = await col<import("../storage/collections").ProviderDoc>("providers");
      const models = (await modelsCol.findBy("model_type", type)).filter(e => e.doc.active);
      for (const m of models) {
        const provider = await providersCol.get(m.doc.provider_id);
        if (provider?.doc.active) return { id: m.doc.id, provider: m.doc.provider_id };
      }
      return null;
    } catch {
      return null;
    }
  }

  async transcribe(audio: AudioInput, modelId: string): Promise<string> {
    let resolved = await this.resolveVoiceModel(modelId, "stt");

    if (!resolved) {
      const fallback = await this.getFirstActiveVoiceModel("stt");
      if (!fallback) throw new Error(`STT model "${modelId}" not found and no active STT models in the database`);
      log.warn(`STT model ${modelId} not found in DB, falling back to ${fallback.provider}/${fallback.id}`);
      resolved = { provider: fallback.provider, modelId: fallback.id };
    }
    const { provider, modelId: resolvedModelId } = resolved;

    switch (provider) {
      // groq revende modelos de terceros, así que sus filas de catálogo llevan
      // el prefijo `groq/` y eso es lo que el canal guarda en stt_provider. El
      // prefijo es una clave de la BD, no un nombre de modelo: mandarlo al cable
      // hacía que la API contestara 400 para CUALQUIER whisper de Groq.
      case "groq":   return this.transcribeWithGroq(audio, wireModelId(provider, resolvedModelId));
      case "openai": return this.transcribeWithOpenAIWhisper(audio);
      default:
        throw new Error(`STT not supported for provider "${provider}" (model ${resolvedModelId})`);
    }
  }

  private async getProviderApiKey(providerId: string): Promise<string | null> {
    const apiKey = await loadProviderApiKey(providerId);
    return apiKey || null;
  }

  private async transcribeWithGroq(audio: AudioInput, modelId: string): Promise<string> {
    const key = await this.getProviderApiKey("groq") || process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY not configured. Configúrala en Proveedores o en las variables de entorno.");
    }

    let audioData: ArrayBuffer | Uint8Array;
    
    if (audio.type === "buffer") {
      audioData = new Uint8Array((audio.data as Buffer));
    } else if (audio.type === "base64") {
      const buf = Buffer.from(audio.data as string, "base64");
      audioData = new Uint8Array(buf);
    } else if (audio.type === "url") {
      const response = await fetch(audio.data as string);
      const ab = await response.arrayBuffer();
      audioData = new Uint8Array(ab);
    } else {
      throw new Error("Invalid audio input type");
    }

    const mime = audio.mimeType || "audio/ogg";
    const ext = mime.includes("webm") ? "webm"
      : mime.includes("mp4") || mime.includes("m4a") ? "m4a"
      : mime.includes("mp3") || mime.includes("mpeg") ? "mp3"
      : mime.includes("wav") ? "wav"
      : mime.includes("flac") ? "flac"
      : "ogg";
    const blob = new Blob([audioData as BlobPart], { type: mime });
    const formData = new FormData();
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", modelId);
    formData.append("response_format", "json");
    formData.append("language", "es");

    const result = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
      },
      body: formData,
    });

    if (!result.ok) {
      const error = await result.text();
      throw new Error(`Groq Whisper transcription failed: ${error}`);
    }

    const data = await result.json() as { text: string };
    return data.text;
  }

  private async transcribeWithOpenAIWhisper(audio: AudioInput): Promise<string> {
    const key = await this.getProviderApiKey("openai") || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY not configured. Configúrala en Proveedores o en las variables de entorno.");
    }

    let audioData: ArrayBuffer | Uint8Array;
    
    if (audio.type === "buffer") {
      audioData = new Uint8Array(audio.data as Buffer);
    } else if (audio.type === "base64") {
      const buf = Buffer.from(audio.data as string, "base64");
      audioData = new Uint8Array(buf);
    } else if (audio.type === "url") {
      const response = await fetch(audio.data as string);
      const ab = await response.arrayBuffer();
      audioData = new Uint8Array(ab);
    } else {
      throw new Error("Invalid audio input type");
    }

    const blob = new Blob([audioData as BlobPart], { type: audio.mimeType || "audio/webm" });
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

    formData.append("model", "whisper-1");
    formData.append("response_format", "json");
    formData.append("language", "es");

    const result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
      },
      body: formData,
    });

    if (!result.ok) {
      const error = await result.text();
      throw new Error(`OpenAI Whisper transcription failed: ${error}`);
    }

    const data = await result.json() as { text: string };
    return data.text;
  }

  async speak(text: string, modelId: string, voiceId?: string): Promise<AudioOutput> {
    if (modelId === "piper-local") return this.speakWithPiper(text, voiceId);

    let resolved = await this.resolveVoiceModel(modelId, "tts");

    if (!resolved) {
      const fallback = await this.getFirstActiveVoiceModel("tts");
      if (!fallback) throw new Error(`TTS model "${modelId}" not found and no active TTS models in the database`);
      log.warn(`TTS model ${modelId} not found in DB, falling back to ${fallback.provider}/${fallback.id}`);
      resolved = { provider: fallback.provider, modelId: fallback.id };
    }
    const { provider, modelId: resolvedModelId } = resolved;

    switch (provider) {
      case "piper":      return this.speakWithPiper(text, voiceId);
      case "elevenlabs": return this.speakWithElevenLabs(text, resolvedModelId, voiceId);
      case "openai":     return this.speakWithOpenAI(text, resolvedModelId, voiceId);
      case "gemini":     return this.speakWithGemini(text, resolvedModelId, voiceId);
      case "qwen":       return this.speakWithQwen(text, resolvedModelId, voiceId);
      // Mismo prefijo de revendedor que en STT: la fila es `groq/canopylabs/...`
      // y al cable va sólo `canopylabs/...`.
      case "groq":       return this.speakWithGroq(text, wireModelId(provider, resolvedModelId), voiceId);
      default:
        throw new Error(`TTS not supported for provider "${provider}" (model ${resolvedModelId})`);
    }
  }

  private async speakWithPiper(text: string, voiceId?: string): Promise<AudioOutput> {
    const cleanText = cleanTextForTTS(text);
    const port = Number(process.env.TTS_PORT ?? 5500);
    const res = await fetch(`http://localhost:${port}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleanText, voice: voiceId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Piper TTS error ${res.status}. ¿Está el servidor TTS corriendo? (Ajustes → Voz)`);
    }
    const wav = await res.arrayBuffer();
    return {
      type: "buffer",
      data: Buffer.from(wav),
      mimeType: "audio/wav",
    };
  }

  private async speakWithElevenLabs(text: string, modelId: string, voiceId?: string): Promise<AudioOutput> {
    const apiKey = await this.getProviderApiKey("elevenlabs");
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    
    if (!key) {
      throw new Error("ELEVENLABS_API_KEY not configured");
    }

    const voice = voiceId || "21m00Tcm4TlvDq8ikWAM";
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": key,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs TTS failed: ${error}`);
    }

    const buffer = await response.arrayBuffer();
    return {
      type: "buffer",
      data: Buffer.from(buffer),
      mimeType: "audio/mpeg",
    };
  }

  private async speakWithOpenAI(text: string, modelId: string = "gpt-4o-mini-tts", voiceId?: string): Promise<AudioOutput> {
    const apiKey = await this.getProviderApiKey("openai-tts");
    const key = apiKey || process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const voice = voiceId || "alloy";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        voice,
        input: text,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS failed: ${error}`);
    }

    const buffer = await response.arrayBuffer();
    return {
      type: "buffer",
      data: Buffer.from(buffer),
      mimeType: "audio/mpeg",
    };
  }

  /**
   * Orpheus (Canopy Labs) sobre el endpoint OpenAI-compatible de Groq. Reemplazó
   * a playai-tts, que Groq deprecó en diciembre de 2025.
   *
   * `wav` es el único `response_format` que Orpheus acepta hoy — no es un default
   * elegido acá, mandar mp3 falla.
   */
  private async speakWithGroq(text: string, modelId: string, voiceId?: string): Promise<AudioOutput> {
    const key = await this.getProviderApiKey("groq") || process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY not configured. Configúrala en Proveedores o en las variables de entorno.");
    }

    const isArabic = modelId.includes("arabic");
    const voice = voiceId || (isArabic ? "abdullah" : "troy");

    const response = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        voice,
        input: cleanTextForTTS(text),
        response_format: "wav",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq TTS failed: ${error}`);
    }

    const buffer = await response.arrayBuffer();
    return {
      type: "buffer",
      data: Buffer.from(buffer),
      mimeType: "audio/wav",
    };
  }

  /** Las seis personas de Orpheus en inglés más las seis del modelo árabe saudí. */
  getGroqVoices(): Array<{ id: string; name: string }> {
    return [
      { id: "autumn", name: "Autumn (F, inglés)" },
      { id: "diana", name: "Diana (F, inglés)" },
      { id: "hannah", name: "Hannah (F, inglés)" },
      { id: "austin", name: "Austin (M, inglés)" },
      { id: "daniel", name: "Daniel (M, inglés)" },
      { id: "troy", name: "Troy (M, inglés)" },
      { id: "lulwa", name: "Lulwa (F, árabe saudí)" },
      { id: "noura", name: "Noura (F, árabe saudí)" },
      { id: "aisha", name: "Aisha (F, árabe saudí)" },
      { id: "abdullah", name: "Abdullah (M, árabe saudí)" },
      { id: "fahad", name: "Fahad (M, árabe saudí)" },
      { id: "sultan", name: "Sultan (M, árabe saudí)" },
    ];
  }

  private async speakWithGemini(text: string, modelId: string, voiceId?: string): Promise<AudioOutput> {
    const key = process.env.GEMINI_API_KEY;

    if (!key) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const voiceName = voiceId || "Aoede";

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Genera audio de este texto: ${text}`,
          }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            languageCode: "es-ES",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini TTS failed: ${error}`);
    }

    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string } }> } }> };
    const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
      throw new Error("No audio returned from Gemini");
    }

    const buffer = Buffer.from(audioData, "base64");
    return {
      type: "buffer",
      data: buffer,
      mimeType: "audio/mpeg",
    };
  }

  private async speakWithQwen(text: string, modelId: string, voiceId?: string): Promise<AudioOutput> {
    const key = process.env.DASHSCOPE_API_KEY;

    if (!key) {
      throw new Error("DASHSCOPE_API_KEY not configured");
    }

    const voice = voiceId || "ruoxi";

    const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/t2a/generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: {
          text,
        },
        parameters: {
          voice,
          format: "mp3",
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen TTS failed: ${error}`);
    }

    const data = await response.json() as { output?: { audio?: string } };
    const audioData = data.output?.audio;
    
    if (!audioData) {
      throw new Error("No audio returned from Qwen");
    }

    const buffer = Buffer.from(audioData, "base64");
    return {
      type: "buffer",
      data: buffer,
      mimeType: "audio/mpeg",
    };
  }

  async getConfiguredVoiceProviders(): Promise<{ groq: boolean; elevenlabs: boolean; openai: boolean; gemini: boolean; qwen: boolean }> {
    const hasDbKey = async (providerId: string): Promise<boolean> => !!(await loadProviderApiKey(providerId));

    const [groq, elevenlabs, openai, gemini, qwen] = await Promise.all([
      hasDbKey("groq"), hasDbKey("elevenlabs"), hasDbKey("openai"), hasDbKey("gemini"), hasDbKey("qwen"),
    ]);

    return {
      groq:       groq       || !!(process.env.GROQ_API_KEY),
      elevenlabs: elevenlabs || !!(process.env.ELEVENLABS_API_KEY),
      openai:     openai     || !!(process.env.OPENAI_API_KEY),
      gemini:     gemini     || !!(process.env.GEMINI_API_KEY),
      qwen:       qwen       || !!(process.env.DASHSCOPE_API_KEY),
    };
  }

  getOpenAIVoices(): Array<{ id: string; name: string }> {
    return [
      { id: "alloy", name: "Alloy" },
      { id: "echo", name: "Echo" },
      { id: "fable", name: "Fable" },
      { id: "onyx", name: "Onyx" },
      { id: "nova", name: "Nova" },
      { id: "shimmer", name: "Shimmer" },
      { id: "ash", name: "Ash" },
      { id: "ballad", name: "Ballad" },
      { id: "coral", name: "Coral" },
      { id: "sage", name: "Sage" },
      { id: "verse", name: "Verse" },
    ];
  }

  getGeminiVoices(): Array<{ id: string; name: string }> {
    return [
      { id: "Puck", name: "Puck" },
      { id: "Charon", name: "Charon" },
      { id: "Kore", name: "Kore" },
      { id: "Fenrir", name: "Fenrir" },
      { id: "Aoede", name: "Aoede" },
      { id: "Orbit", name: "Orbit" },
      { id: "Zephyr", name: "Zephyr" },
      { id: "Autonoe", name: "Autonoe" },
      { id: "Enceladus", name: "Enceladus" },
      { id: "Iapetus", name: "Iapetus" },
      { id: "Umbriel", name: "Umbriel" },
      { id: "Algieba", name: "Algieba" },
      { id: "Despina", name: "Despina" },
      { id: "Erinome", name: "Erinome" },
      { id: "Laomedeia", name: "Laomedeia" },
      { id: "Achernar", name: "Achernar" },
      { id: "Rasalgethi", name: "Rasalgethi" },
      { id: "Schedar", name: "Schedar" },
      { id: "Sulafat", name: "Sulafat" },
      { id: "Vindemiatrix", name: "Vindemiatrix" },
      { id: "Zubenelgenubi", name: "Zubenelgenubi" },
      { id: "Pulcherrima", name: "Pulcherrima" },
      { id: "Achird", name: "Achird" },
      { id: "Zubeneschamali", name: "Zubeneschamali" },
      { id: "Sadachbia", name: "Sadachbia" },
      { id: "Sadaltager", name: "Sadaltager" },
      { id: "Sheratan", name: "Sheratan" },
    ];
  }

  getQwenVoices(): Array<{ id: string; name: string }> {
    return [
      { id: "ruoxi", name: "Ruoxi (F, Chinese)" },
      { id: "longhua", name: "Longhua (M, Chinese)" },
      { id: "lingli", name: "Lingli (F, Chinese)" },
      { id: "zhiyan", name: "Zhiyan (F, Chinese)" },
      { id: "aicheng", name: "Aicheng (F, Chinese)" },
      { id: "aida", name: "Aida (F, Chinese)" },
      { id: "yucheng", name: "Yucheng (M, Chinese)" },
      { id: "yijia", name: "Yijia (F, Chinese)" },
      { id: "yinan", name: "Yinan (M, Chinese)" },
      { id: "sijia", name: "Sijia (F, Chinese)" },
      { id: "sicheng", name: "Sicheng (M, Chinese)" },
      { id: "siqi", name: "Siqi (F, Chinese)" },
      { id: "aixia", name: "Aixia (F, Chinese)" },
    ];
  }

  async getElevenLabsVoices(): Promise<Array<{ id: string; name: string; category: string }>> {
    const apiKey = await this.getProviderApiKey("elevenlabs");
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    
    if (!key) {
      throw new Error("ELEVENLABS_API_KEY not configured");
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": key,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch ElevenLabs voices: ${error}`);
    }

    const data = await response.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
    return data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  }

  normalizeAudioFromChannel(channelType: string, audioData: unknown): AudioInput {
    switch (channelType) {
      case "telegram":
        return this.normalizeTelegramAudio(audioData);
      case "discord":
        return this.normalizeDiscordAudio(audioData);
      case "whatsapp":
        return this.normalizeWhatsAppAudio(audioData);
      case "slack":
        return this.normalizeSlackAudio(audioData);
      case "webchat":
        return this.normalizeWebChatAudio(audioData);
      default:
        throw new Error(`Unknown channel type: ${channelType}`);
    }
  }

  private normalizeTelegramAudio(audioData: unknown): AudioInput {
    const data = audioData as { fileId?: string; buffer?: Buffer; url?: string };
    
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: "audio/ogg" };
    }
    if (data.url) {
      return { type: "url", data: data.url, mimeType: "audio/ogg" };
    }
    throw new Error("Telegram audio missing buffer or URL");
  }

  private normalizeDiscordAudio(audioData: unknown): AudioInput {
    const data = audioData as { buffer?: Buffer; url?: string; mimeType?: string };
    
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: data.mimeType || "audio/webm" };
    }
    if (data.url) {
      return { type: "url", data: data.url, mimeType: data.mimeType || "audio/webm" };
    }
    throw new Error("Discord audio missing buffer or URL");
  }

  private normalizeWhatsAppAudio(audioData: unknown): AudioInput {
    const data = audioData as { buffer?: Buffer; url?: string; base64?: string };

    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: "audio/ogg" };
    }
    if (data.base64) {
      return { type: "base64", data: data.base64, mimeType: "audio/ogg" };
    }
    if (data.url) {
      return { type: "url", data: data.url, mimeType: "audio/ogg" };
    }
    throw new Error("WhatsApp audio: buffer not available — download may have failed");
  }

  private normalizeSlackAudio(audioData: unknown): AudioInput {
    const data = audioData as { buffer?: Buffer; url?: string; mimeType?: string };
    
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: data.mimeType || "audio/webm" };
    }
    if (data.url) {
      return { type: "url", data: data.url, mimeType: data.mimeType || "audio/webm" };
    }
    throw new Error("Slack audio missing buffer or URL");
  }

  private normalizeWebChatAudio(audioData: unknown): AudioInput {
    const data = audioData as { base64?: string; buffer?: Buffer };
    
    if (data.base64) {
      return { type: "base64", data: data.base64, mimeType: "audio/webm" };
    }
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: "audio/webm" };
    }
    throw new Error("WebChat audio missing base64 or buffer");
  }
}

export const voiceService = VoiceService.getInstance();
