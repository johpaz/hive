import { Badge } from "@/components/ui/badge";
import type { ModelCapability } from "@/types";

const capLabels: Record<ModelCapability, string> = {
  chat: "Chat",
  vision: "Vision",
  json_mode: "JSON",
  function_calling: "Functions",
  streaming: "Stream",
  embeddings: "Embed",
  image_generation: "Imagen",
  code: "Codigo",
  reasoning: "Razonamiento",
  transcription: "STT",
  translation: "Traduccion",
  tts: "TTS",
  speech: "Voz",
  high_quality: "HQ",
  ocr: "OCR",
};

interface ModelCapabilitiesProps {
  capabilities?: string | ModelCapability[] | null;
}

export function ModelCapabilities({ capabilities }: ModelCapabilitiesProps) {
  // Parse capabilities if it's a string
  let caps: ModelCapability[] = [];
  if (typeof capabilities === 'string') {
    try {
      caps = JSON.parse(capabilities);
    } catch {
      caps = [];
    }
  } else if (Array.isArray(capabilities)) {
    caps = capabilities;
  }

  if (caps.length === 0) return null;

  return (
    <>
      {caps.map((cap) => (
        <Badge key={cap} variant="outline" className="text-[10px] py-0 h-4">
          {capLabels[cap] ?? cap}
        </Badge>
      ))}
    </>
  );
}
