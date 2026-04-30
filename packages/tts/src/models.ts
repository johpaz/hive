/**
 * Hive TTS — Índice de modelos disponibles
 * Modelos en español desde HuggingFace
 */

export interface TTSModel {
  id: string
  name: string
  language: string
  quality: "low" | "medium" | "high"
  size: string
  modelUrl: string
  configUrl: string
}

const HF_BASE = "https://huggingface.co/spaces/HirCoir/Piper-TTS-Spanish/resolve/main"

export const TTS_MODELS: TTSModel[] = [
  {
    id: "es_MX-claude-14947-epoch-high",
    name: "Claude (México)",
    language: "es-MX",
    quality: "high",
    size: "63.1 MB",
    modelUrl: `${HF_BASE}/es_MX-claude-14947-epoch-high.onnx`,
    configUrl: `${HF_BASE}/es_MX-claude-14947-epoch-high.onnx.json`,
  },
  {
    id: "es_MX-cortana-19669-epoch-high",
    name: "Cortana (México)",
    language: "es-MX",
    quality: "high",
    size: "63.1 MB",
    modelUrl: `${HF_BASE}/es_MX-cortana-19669-epoch-high.onnx`,
    configUrl: `${HF_BASE}/es_MX-cortana-19669-epoch-high.onnx.json`,
  },
  {
    id: "es_MX-gevy-10196-epoch-high",
    name: "Gevy (México)",
    language: "es-MX",
    quality: "high",
    size: "63.1 MB",
    modelUrl: `${HF_BASE}/es_MX-gevy-10196-epoch-high.onnx`,
    configUrl: `${HF_BASE}/es_MX-gevy-10196-epoch-high.onnx.json`,
  },
]

export function getModelById(id: string): TTSModel | undefined {
  return TTS_MODELS.find((m) => m.id === id)
}
