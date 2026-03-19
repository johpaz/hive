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

export { getDb, initializeDatabase, getDbPathLazy, dbService } from "@johpaz/hive/storage/sqlite";

export { SCHEMA, PROJECTS_SCHEMA, CONTEXT_ENGINE_SCHEMA } from "@johpaz/hive/storage/schema";

export { seedAllData, seedToolsAndSkills, getAllElements, getActiveElements } from "@johpaz/hive/storage/seed";

export { encrypt, decrypt, encryptApiKey, decryptApiKey, encryptConfig, decryptConfig, hashPassword, verifyPassword, maskApiKey } from "@johpaz/hive/storage/crypto";

export {
  getAllProviders,
  getAllModels,
  getAllEthics,
  getAllCodeBridge,
  getAllSkills,
  getAllDbTools,
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
} from "@johpaz/hive/storage/onboarding";
