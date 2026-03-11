export type EthicsLevel = "paranoid" | "strict" | "balanced" | "permissive" | "custom";

export interface EthicsRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: "block" | "warn" | "info";
  enabled: boolean;
  conditions: string[];
}

export interface EthicsConfig {
  id: string;
  agentId: string;
  level: EthicsLevel;
  content: string;
  rules: EthicsRule[];
  templateId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EthicsTemplate {
  id: string;
  name: string;
  description: string;
  level: EthicsLevel;
  rules: EthicsRule[];
  content: string;
}

export interface EthicsConflict {
  id: string;
  soulRule: string;
  ethicsRule: string;
  description: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}
