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
