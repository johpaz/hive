/**
 * Hive SDK - Ethics Module
 *
 * Exposes the constitutional ethics system and ethics rule management.
 *
 * @example
 * import { getAllEthics, activateEthics } from "@johpaz/hive-agents-sdk/ethics";
 *
 * // Get all ethics rules
 * const rules = getAllEthics();
 */

export {
  getAllEthics,
  activateEthics,
} from "@johpaz/hive-agents-core/storage/onboarding";
