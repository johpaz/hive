/**
 * Hive SDK - Skills Module
 *
 * Exposes the skill registry, base skills, and skill loader.
 *
 * @example
 * import { SkillLoader, createSkillLoader } from "@johpaz/hive-agents-sdk/skills";
 *
 * // Create a skill loader
 * const loader = createSkillLoader({ workspacePath: "/path/to/workspace" });
 */

export {
  SkillLoader,
  createSkillLoader,
  type SkillsConfig,
  type Config,
  type SkillStep,
  type OutputFormat,
  type SkillExample,
  type SkillMetadata,
  type Skill,
} from "@johpaz/hive-agents-skills/loader";
