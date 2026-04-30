import { getDb } from "../storage/sqlite";
import { decryptApiKey } from "../storage/crypto";
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

  getChannelVoiceConfig(channelId: string): VoiceConfig {
    const db = getDb();
    const result = db.query(`
      SELECT voice_enabled, tts_enabled, stt_provider, tts_provider, tts_voice_id
      FROM channels WHERE id = ?
    `).get(channelId) as {
      voice_enabled: number;
      tts_enabled: number;
      stt_provider: string | null;
      tts_provider: string | null;
      tts_voice_id: string | null;
    } | undefined;

    if (!result) {
      return {
        voiceEnabled: false,
        ttsEnabled: false,
        sttProvider: null,
        ttsProvider: null,
        ttsVoiceId: null,
      };
    }

    return {
      voiceEnabled: result.voice_enabled === 1,
      ttsEnabled: result.tts_enabled === 1,
      sttProvider: result.stt_provider,
      ttsProvider: result.tts_provider,
      ttsVoiceId: result.tts_voice_id,
    };
  }

  async transcribe(audio: AudioInput, modelId: string): Promise<string> {
    const isGroq = modelId.startsWith("whisper");
    const isOpenAi = modelId === "whisper-1";
    
    if (isGroq) {
      return this.transcribeWithGroq(audio, modelId);
    } else if (isOpenAi) {
      return this.transcribeWithOpenAIWhisper(audio);
    }
    
    log.warn(`Unknown STT provider ${modelId}, defaulting to Groq Whisper`);
    return this.transcribeWithGroq(audio, "whisper-large-v3-turbo");
  }

  private async getProviderApiKey(providerId: string): Promise<string | null> {
    const db = getDb();
    const provider = db.query(`
      SELECT api_key_encrypted, api_key_iv FROM providers WHERE id = ?
    `).get(providerId) as { api_key_encrypted: string; api_key_iv: string } | undefined;

    if (!provider?.api_key_encrypted) {
      return null;
    }

    try {
      return await decryptApiKey(provider.api_key_encrypted, provider.api_key_iv);
    } catch (error) {
      log.error(`Failed to decrypt API key for provider ${providerId}: ${(error as Error).message}`);
      return null;
    }
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
    const isElevenLabs = modelId.startsWith("eleven");
    const isOpenAI = modelId.startsWith("tts-") || modelId.startsWith("gpt-");
    const isGemini = modelId.startsWith("gemini");
    const isQwen = modelId.startsWith("qwen");
    const isPiper = modelId === "piper" || modelId === "piper-local";

    if (isPiper) {
      return this.speakWithPiper(text, voiceId);
    } else if (isElevenLabs) {
      return this.speakWithElevenLabs(text, modelId, voiceId);
    } else if (isOpenAI) {
      return this.speakWithOpenAI(text, modelId, voiceId);
    } else if (isGemini) {
      return this.speakWithGemini(text, modelId, voiceId);
    } else if (isQwen) {
      return this.speakWithQwen(text, modelId, voiceId);
    }

    log.warn(`Unknown TTS provider ${modelId}, defaulting to ElevenLabs Flash`);
    return this.speakWithElevenLabs(text, "eleven_flash_v2_5", voiceId);
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

  getConfiguredVoiceProviders(): { groq: boolean; elevenlabs: boolean; openai: boolean; gemini: boolean; qwen: boolean } {
    const db = getDb();
    const hasDbKey = (providerId: string): boolean => {
      const row = db.query(
        `SELECT api_key_encrypted FROM providers WHERE id = ? AND api_key_encrypted IS NOT NULL AND api_key_encrypted != ''`
      ).get(providerId) as { api_key_encrypted: string } | undefined;
      return !!row;
    };

    return {
      groq:       hasDbKey("groq")       || !!(process.env.GROQ_API_KEY),
      elevenlabs: hasDbKey("elevenlabs") || !!(process.env.ELEVENLABS_API_KEY),
      openai:     hasDbKey("openai")     || !!(process.env.OPENAI_API_KEY),
      gemini:     hasDbKey("gemini")     || !!(process.env.GEMINI_API_KEY),
      qwen:       hasDbKey("qwen")       || !!(process.env.DASHSCOPE_API_KEY),
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
