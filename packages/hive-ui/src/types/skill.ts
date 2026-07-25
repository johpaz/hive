export type SkillSource = "bundled" | "user";

export interface Skill {
  id: string;
  name: string;
  description?: string;
  category: string;
  tools: string;        // comma-separated tool IDs
  triggers: string;     // comma-separated trigger patterns
  body: string;         // markdown content
  version: number;
  active: boolean;
}
