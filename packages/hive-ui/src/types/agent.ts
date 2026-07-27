export type AgentStatus = "active" | "idle" | "hibernated" | "error" | "thinking" | "archived";

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  tools: string[];
  headers?: Record<string, string>;
}

export interface Agent {
  // Basic fields
  id: string;
  userId?: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  tone?: string;

  // Role & status
  role: 'coordinator' | 'worker';
  status: AgentStatus;
  enabled: boolean;

  // Provider & model
  provider_id?: string; // snake_case from DB
  providerId?: string; // camelCase from API
  model_id?: string; // snake_case from DB
  modelId?: string; // camelCase from API

  // Tools & skills
  toolsJson?: string;
  skillsJson?: string;
  minimalTools?: string[];
  minimalSkills?: Array<{
    id: string;
    name: string;
    description?: string;
    category?: string;
    tools?: string;
  }>;

  // Hierarchy
  parentId?: string;
  maxIterations?: number;

  // "catalog" for the seeded personas (agent-catalog.ts), "user" otherwise.
  // Catalog agents live in the same `agents` table — no separate collection/endpoint.
  source?: "user" | "catalog";
  ace?: { helpful: number; harmful: number } | null;
  lastVerification?: { status: string; taskId: string; createdAt: number } | null;

  // Workspace
  workspace?: string;

  // Headers (encrypted)
  headers_encrypted?: string;
  headers_iv?: string;
  hasHeaders?: boolean;

  // Timestamps
  created_at?: number;
  createdAt?: string | number;
  updatedAt?: string | number;

  // Virtual/Extra fields for UI
  taskCount?: number;
  successRate?: number;
  user_preferences?: string;
}

export interface AgentActivity {
  id: string;
  agentId: string;
  action: string;
  timestamp: string;
  details: string;
  status: "success" | "error" | "pending";
}
