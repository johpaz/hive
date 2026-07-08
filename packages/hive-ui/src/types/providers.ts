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
  capabilities?: string | null;
  enabled: boolean;
  active?: boolean;
}
