import type { ModelDefinition, ProviderType } from "@/types/providers";

export const AVAILABLE_MODELS: Record<ProviderType, Partial<ModelDefinition>[]> = {
    anthropic: [
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", description: "Recomendado — mejor equilibrio, 1M contexto", contextWindow: 200000, isAvailable: true, isDefault: true },
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", description: "Más potente — agentic coding, 1M contexto", contextWindow: 200000, isAvailable: true, isDefault: false },
        { id: "claude-haiku-4-6", name: "Claude Haiku 4.6", description: "Más rápido y económico", contextWindow: 200000, isAvailable: true, isDefault: false },
    ],
    openai: [
        { id: "gpt-5.2", name: "GPT-5.2", description: "Recomendado — 400K contexto, latest", contextWindow: 400000, isAvailable: true, isDefault: true },
        { id: "gpt-5.1", name: "GPT-5.1", description: "Versión anterior estable", contextWindow: 128000, isAvailable: true, isDefault: false },
        { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "Especializado en código", contextWindow: 128000, isAvailable: true, isDefault: false },
        { id: "o4-mini", name: "o4-mini", description: "Razonamiento avanzado, económico", contextWindow: 128000, isAvailable: true, isDefault: false },
    ],
    gemini: [
        { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)", description: "Frontier-class, muy económico", contextWindow: 1000000, isAvailable: true, isDefault: false },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Recomendado — estable, rápido", contextWindow: 1000000, isAvailable: true, isDefault: true },
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Más potente — razonamiento profundo", contextWindow: 2000000, isAvailable: true, isDefault: false },
        { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", description: "Latest — tareas complejas", contextWindow: 2000000, isAvailable: true, isDefault: false },
    ],
    deepseek: [
        { id: "deepseek-chat", name: "DeepSeek-V3", description: "Recomendado — muy económico, capaz", contextWindow: 64000, isAvailable: true, isDefault: true },
        { id: "deepseek-reasoner", name: "DeepSeek-R1", description: "Razonamiento profundo", contextWindow: 64000, isAvailable: true, isDefault: false },
        { id: "deepseek-coder", name: "DeepSeek Coder", description: "Especializado en código", contextWindow: 64000, isAvailable: true, isDefault: false },
    ],
    kimi: [
        { id: "kimi-k2.5", name: "Kimi K2.5", description: "Recomendado — multimodal, agentic, 1T params", contextWindow: 200000, isAvailable: true, isDefault: true },
        { id: "kimi-k2-thinking", name: "Kimi K2 Thinking", description: "Largo razonamiento", contextWindow: 200000, isAvailable: true, isDefault: false },
        { id: "kimi-k2-turbo-preview", name: "Kimi K2 Turbo", description: "Rápido, preview", contextWindow: 128000, isAvailable: true, isDefault: false },
    ],
    openrouter: [
        { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", description: "Gratis — GPT-4 level", contextWindow: 128000, isAvailable: true, isDefault: true },
        { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash", description: "Gratis — 1M contexto", contextWindow: 1000000, isAvailable: true, isDefault: false },
        { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1", description: "Gratis — razonamiento fuerte", contextWindow: 64000, isAvailable: true, isDefault: false },
        { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", description: "Vía OpenRouter", contextWindow: 200000, isAvailable: true, isDefault: false },
    ],
    ollama: [
        { id: "llama3.3:8b", name: "Llama 3.3 8B", description: "Recomendado — general, ~5GB RAM", contextWindow: 8192, isAvailable: true, isDefault: true },
        { id: "qwen2.5:7b", name: "Qwen 2.5 7B", description: "Multilingual, código, ~4.5GB RAM", contextWindow: 32768, isAvailable: true, isDefault: false },
        { id: "mistral:7b", name: "Mistral 7B", description: "Rápido, ~4GB RAM", contextWindow: 32768, isAvailable: true, isDefault: false },
        { id: "phi4:14b", name: "Phi-4 14B", description: "Mejor calidad, ~8GB RAM", contextWindow: 16384, isAvailable: true, isDefault: false },
    ],
    mistral: [],
    groq: [],
    cohere: [],
    nvidia: [],
    hiveagents: [
        { id: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf", name: "Qwen3.6 35B MoE Q4 (Recomendado)", description: "MoE 22.7GB — 62.8 t/s, el más rápido", contextWindow: 200000, isAvailable: true, isDefault: true, supportsThinking: true },
        { id: "Qwen3.6-35B-A3B-UD-Q6_K.gguf", name: "Qwen3.6 35B MoE Q6", description: "MoE 30GB — 57.7 t/s", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "Qwen3-Coder-Next-UD-Q4_K_M.gguf", name: "Qwen3 Coder Next MoE Q4", description: "MoE 49.3GB — 50.9 t/s, ocupa toda la VRAM", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "gemma-4-26B-A4B-UD-Q4_K_M.gguf", name: "Gemma 4 26B MoE Q4", description: "MoE 16.9GB — 51.5 t/s", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "gemma-4-26B-A4B-UD-Q6_K_XL.gguf", name: "Gemma 4 26B MoE Q6", description: "MoE 23.3GB — 47.8 t/s", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "gemma-4-12b-it-UD-Q4_K_XL.gguf", name: "Gemma 4 12B Dense Q4", description: "Dense 7.4GB — 27.7 t/s", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "Qwopus3.6-27B-v2-MTP-Q6_K.gguf", name: "Qwopus 27B Dense+MTP Q6", description: "Dense+MTP 22.4GB — 17.9 t/s, speculative decoding", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "Qwen3.6-27B-UD-Q6_K_XL.gguf", name: "Qwen3.6 27B Dense+MTP Q6", description: "Dense+MTP 26GB — 16 t/s, speculative decoding", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
        { id: "gemma-4-31B-it-UD-Q6_K_XL.gguf", name: "Gemma 4 31B Dense Q6", description: "Dense 27.5GB — 7.6 t/s, mayor calidad", contextWindow: 200000, isAvailable: true, isDefault: false, supportsThinking: true },
    ],
};

// Map these simplified partial models into full ModelDefinition objects
export function getModelsForProvider(providerType: ProviderType): ModelDefinition[] {
    const models = AVAILABLE_MODELS[providerType] || [];
    return models.map((m) => ({
        id: m.id!,
        provider: providerType,
        name: m.name!,
        description: m.description || "",
        capabilities: ["chat"],
        contextWindow: m.contextWindow || 8192,
        pricing: { inputPer1M: 0, outputPer1M: 0, currency: "USD" },
        performance: { latency: "medium", quality: "medium" },
        recommendedFor: [],
        isAvailable: m.isAvailable ?? true,
        isDefault: m.isDefault ?? false,
    }));
}
