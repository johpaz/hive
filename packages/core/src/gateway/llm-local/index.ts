/**
 * Hive Local LLM — Index
 * Exporta todo el módulo
 */

export { detectGPU, getHiveCLIBinaryName, getHiveCLIDownloadURL, getLlamaServerSuffix, getLlamaServerDownloadURL } from "./detector"
export type { GPUBackend, GPUInfo, PlatformArch } from "./detector"

export {
  installHiveCLI,
  installLlamaServer,
  findLlamaServerBinary,
  downloadModel,
  installMMProj,
  listLocalModels,
  isModelDownloaded,
  getModelPath,
  BIN_DIR,
  MODELS_DIR,
  HF_MODEL_URLS,
} from "./downloader"
export type { ModelId } from "./downloader"

export { getModelConfig, buildLlamaServerArgs, buildHiveCLIArgs, getRecommendedModel } from "./models"
export type { ModelConfig } from "./models"

export { llamaManager } from "./manager"
export type { ServerMode } from "./manager"

export { handleLLMWebSocket, handleLLMStatus } from "./server"
export type { LLMMessage } from "./server"

export { isLocalLLMAvailable, generateLocal, generateLocalComplete } from "./client"
export type { GenerateOptions } from "./client"
