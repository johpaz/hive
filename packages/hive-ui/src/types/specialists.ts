export type SpecialistWorkspaceScope =
  | { kind: "none" }
  | { kind: "workspace"; read_globs: string[]; write_globs: string[] }
  | { kind: "resource"; resource_types: string[] };

export interface SpecialistModelOverride {
  required_capabilities: string[];
  preferred_model_ids: string[];
  fallback: "general";
  prefer_different_family?: boolean;
}

export interface SpecialistAcceptanceCriterion {
  id: string;
  description: string;
  check_tool?: string | null;
}

export interface SpecialistWorker {
  id: string;
  status: string;
  currentTool: string | null;
  parentId: string;
  workspace: string | null;
  updatedAt: number;
}

export interface SpecialistLastVerification {
  status: string;
  taskId: string;
  createdAt: number;
}

export interface Specialist {
  id: string;
  name: string;
  description: string;
  active: boolean;
  source: "seed" | "curator";
  seedVersion: number;
  tools: string[];
  skills: string[];
  mcpServerIds: string[];
  workspaceScope: SpecialistWorkspaceScope;
  modelOverride: SpecialistModelOverride | null;
  acceptance: SpecialistAcceptanceCriterion[];
  ace: { helpful: number; harmful: number };
  runtime: {
    state: "awake" | "dormant";
    workers: SpecialistWorker[];
  };
  lastVerification: SpecialistLastVerification | null;
  createdAt: number;
  updatedAt: number;
}
