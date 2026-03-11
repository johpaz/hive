import { create } from "zustand";
import { apiClient } from "@/lib/api";

export type ProjectStatus = "pending" | "active" | "paused" | "done" | "failed";
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";
export type ProjectType = "general" | "code" | "research" | "content" | "data";

export interface Task {
  id: number;
  project_id: string;
  agent_id: string | null;
  parent_task_id: number | null;
  name: string;
  description: string | null;
  status: TaskStatus;
  progress: number;
  result: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface Project {
  id: string;
  user_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  type: ProjectType;
  task: string | null;
  progress: number;
  status: ProjectStatus;
  context: string | null;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  tasks: Task[];
}

interface ProjectsStore {
  projects: Project[];
  isLoading: boolean;

  fetchProjects: (status?: string) => Promise<void>;
  fetchActiveProjects: () => Promise<void>;
  updateTaskLocal: (taskId: number, updates: Partial<Task>) => void;
  updateProjectLocal: (projectId: string, updates: Partial<Project>) => void;
}

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  isLoading: false,

  fetchProjects: async (status?: string) => {
    set({ isLoading: true });
    try {
      const endpoint = status ? `/api/projects?status=${status}` : "/api/projects";
      const data = await apiClient<{ projects: Project[] } | { project: Project } | Project[]>(endpoint, {
        showLoader: false,
        showError: true,
      });
      console.log("[ProjectsStore] fetchProjects - API Response:", data);
      let projects: Project[] = [];
      if (Array.isArray(data)) {
        projects = data;
        console.log("[ProjectsStore] Response es array directo:", projects.length, "proyectos");
      } else if ('projects' in data) {
        projects = data.projects;
        console.log("[ProjectsStore] Response tiene propiedad 'projects':", projects.length, "proyectos");
      } else if ('project' in data) {
        projects = data.project ? [data.project] : [];
        console.log("[ProjectsStore] Response tiene propiedad 'project':", projects.length, "proyecto(s)");
      } else if (data && typeof data === 'object' && 'id' in data) {
        projects = [data as Project];
        console.log("[ProjectsStore] Response es un proyecto directo:", projects.length, "proyecto");
      } else {
        console.warn("[ProjectsStore] Formato de respuesta desconocido:", data);
      }
      set({ projects });
    } catch (err) {
      console.error("[ProjectsStore] Error en fetchProjects:", err);
      set({ projects: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchActiveProjects: async () => {
    set({ isLoading: true });
    try {
      const data = await apiClient<{ projects: Project[] } | { project: Project } | Project[]>("/api/projects/active", {
        showLoader: false,
        showError: true,
      });
      console.log("[ProjectsStore] fetchActiveProjects - API Response:", data);
      let projects: Project[] = [];
      if (Array.isArray(data)) {
        projects = data;
        console.log("[ProjectsStore] Response es array directo:", projects.length, "proyectos");
      } else if ('projects' in data) {
        projects = data.projects;
        console.log("[ProjectsStore] Response tiene propiedad 'projects':", projects.length, "proyectos");
      } else if ('project' in data) {
        projects = data.project ? [data.project] : [];
        console.log("[ProjectsStore] Response tiene propiedad 'project':", projects.length, "proyecto(s)");
      } else if (data && typeof data === 'object' && 'id' in data) {
        projects = [data as Project];
        console.log("[ProjectsStore] Response es un proyecto directo:", projects.length, "proyecto");
      } else {
        console.warn("[ProjectsStore] Formato de respuesta desconocido:", data);
      }
      set({ projects });
    } catch (err) {
      console.error("[ProjectsStore] Error en fetchActiveProjects:", err);
      set({ projects: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  updateTaskLocal: (taskId, updates) => {
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === taskId ? { ...t, ...updates } : t
        ),
      })),
    }));
  },

  updateProjectLocal: (projectId, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, ...updates } : p
      ),
    }));
  },
}));
