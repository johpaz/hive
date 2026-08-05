export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "kimi"
  | "ollama"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | "groq"
  | "cohere"
  | "nvidia"
  | "minimax"
  | "qwen"
  | "z-ai"
  | "modelscope"
  | "opencode-go"
  | "hiveagents";

export type ProviderStatus = "active" | "fallback" | "error" | "disabled";

export type ModelCapability =
  | "chat"
  | "vision"
  | "json_mode"
  | "function_calling"
  | "streaming"
  | "embeddings"
  | "image_generation"
  | "code"
  | "reasoning"
  | "transcription"
  | "translation"
  | "tts"
  | "speech"
  | "high_quality"
  | "ocr";

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel: string;
  availableModels: string[];
  maxRetries: number;
  timeoutMs: number;
  rateLimitRpm?: number;
  headers?: Record<string, string>;
}

export interface ProviderOpenAIConfig {
  apiKey: string;
  organization?: string;
  baseUrl?: string;
  defaultModel: string;
  availableModels: string[];
}

export interface ProviderAnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  maxTokens: number;
}

export interface ProviderOllamaConfig {
  baseUrl: string;
  defaultModel: string;
  availableModels: string[];
}

export interface ProviderGoogleConfig {
  apiKey: string;
  projectId?: string;
  location?: string;
  defaultModel: string;
}

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  currency: string;
}

export interface ModelPerformance {
  latency: "low" | "medium" | "high";
  quality: "low" | "medium" | "high" | "highest";
}

export interface ModelDefinition {
  id: string;
  provider: ProviderType;
  name: string;
  description: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens?: number;
  pricing: ModelPricing;
  performance: ModelPerformance;
  recommendedFor: string[];
  isAvailable: boolean;
  isDefault: boolean;
  supportsThinking?: boolean;
}

export interface Provider {
  id: string;
  type?: ProviderType;
  name: string;
  /** Uso principal del provider según la BD: 'llm' (texto), 'stt' o 'tts' */
  category?: string;
  status?: ProviderStatus;
  config?: ProviderConfig;
  models?: Model[];
  createdAt?: string;
  updatedAt?: string;
  usageStats?: ProviderUsageStats;
  baseUrl?: string | null;
  base_url?: string | null;
  num_ctx?: number | null;
  enabled: boolean;
  active?: boolean;
  has_api_key?: boolean;
  has_headers?: boolean;
  masked_api_key?: string | null;
}

export interface ProviderUsageStats {
  totalTokens: number;
  tokensLast24h: number;
  totalCostUsd: number;
  costLast24h: number;
  requestsLast24h: number;
  avgLatencyMs: number;
}

export interface FailoverConfig {
  primary: ProviderType;
  fallbacks: ProviderType[];
  triggerConditions: {
    onError: boolean;
    onRateLimit: boolean;
    onTimeout: boolean;
    maxLatencyMs?: number;
  };
  recoveryStrategy: {
    retryPrimaryAfter: number;
    circuitBreaker: boolean;
  };
}

export interface Model {
  id: string;
  name: string;
  providerId?: string;
  provider_id?: string;
  model_type?: string;
  contextWindow?: number | null;
  context_window?: number | null;
  capabilities?: string | null;
  enabled: boolean;
  active?: boolean;
  /**
   * USD por millón de tokens, del catálogo del backend. `null` = tarifa
   * desconocida, que no es lo mismo que 0 (endpoint gratuito).
   */
  input_per_1m?: number | null;
  output_per_1m?: number | null;
  inputPer1M?: number | null;
  outputPer1M?: number | null;
  source?: "catalog" | "discovered";
  /**
   * Nombre que el provider espera en el cable, derivado por el backend. En los
   * providers revendedores `id` lleva el prefijo del provider y este no; la
   * lista de revendedores vive en core y no se duplica en la UI.
   */
  wire_id?: string;
}

/**
 * Campos editables de un modelo desde la UI. Todo es opcional para poder mandar
 * sólo lo que cambió; en los precios `null` es un cambio explícito a
 * "sin tarifa", distinto de omitir la clave.
 */
export interface ModelFormData {
  /** Nombre que el provider espera en el cable (sin el prefijo del revendedor). */
  id?: string;
  name?: string;
  model_type?: string;
  context_window?: number;
  input_per_1m?: number | null;
  output_per_1m?: number | null;
  capabilities?: string[] | null;
}
