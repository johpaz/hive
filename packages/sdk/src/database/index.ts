/**
 * Hive SDK - Database Module
 * 
 * Exposes database access, schema, and crypto utilities.
 * 
 * @example
 * import { getDb, initDatabase, SCHEMA } from "@johpaz/hive-sdk/database";
 * 
 * // Initialize database
 * initDatabase();
 * 
 * // Get database instance
 * const db = getDb();
 */

export { getDb, initializeDatabase, getDbPathLazy, dbService } from "@johpaz/hive-core/storage/sqlite";

export { SCHEMA, PROJECTS_SCHEMA, CONTEXT_ENGINE_SCHEMA } from "@johpaz/hive-core/storage/schema";

export { seedAllData, seedToolsAndSkills, getAllElements, getActiveElements } from "@johpaz/hive-core/storage/seed";

export { encrypt, decrypt, encryptApiKey, decryptApiKey, encryptConfig, decryptConfig, hashPassword, verifyPassword, maskApiKey } from "@johpaz/hive-core/storage/crypto";

export {
  getAllProviders,
  getAllModels,
  getAllEthics,
  getAllCodeBridge,
  getAllSkills,
  getAllTools,
  getAllMcpServers,
  getAllChannels,
  getActiveTools,
  getUserAgents,
  resolveUserId,
  resolveAgentId,
  getSingleUserId,
  getCoordinatorAgentId,
  getDefaultAgentId,
  getAgentConfig,
} from "@johpaz/hive-core/storage/onboarding";
