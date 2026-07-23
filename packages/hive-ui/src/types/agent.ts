export type AgentStatus = "active" | "idle" | "hibernated" | "error" | "thinking";

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

  // Hierarchy
  parentId?: string;
  maxIterations?: number;

  // Set when this worker was materialized from a dormant specialist template
  specialistId?: string | null;

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
