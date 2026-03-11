export interface UserPreference {
  id: string;
  key: string;
  value: string;
  category: string;
}

export interface UserMemory {
  id: string;
  content: string;
  source: "manual" | "inferred" | "imported";
  tags: string[];
  relevance: number;
  createdAt: string;
}

export interface UserConfig {
  id: string;
  agentId: string;
  content: string;
  preferences: UserPreference[];
  memories: UserMemory[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
