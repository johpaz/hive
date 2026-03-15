import { create } from "zustand";
import React from "react";
import type { Provider, Model, Agent, Tool, Skill, MCPServer, ConnectedChannel } from "@/types";
import { apiClient } from "@/lib/api";

// ==================== PROVIDERS ====================
interface ProvidersState {
  providers: Provider[];
  activeProviders: Provider[];
  isLoading: boolean;
  fetchProviders: () => Promise<void>;
  toggleProvider: (id: string, active: boolean) => Promise<void>;
  updateProvider: (id: string, data: any) => Promise<void>;
}

const createProvidersSlice = () => ({
  providers: [] as Provider[],
  activeProviders: [] as Provider[],
  isLoading: false,

  fetchProviders: async () => {
    try {
      const response = await apiClient<{ providers: Provider[] }>("/api/providers");
      const providers = response.providers;
      return {
        providers,
        activeProviders: providers.filter(p => p.enabled && p.active),
      };
    } catch (error) {
      console.error("Failed to fetch providers:", error);
      return { providers: [], activeProviders: [] };
    }
  },

  toggleProvider: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/providers/${id}/toggle`, {
        method: "POST",
        body: { active },
        showLoader: active ? "Activando proveedor..." : "Desactivando proveedor...",
        showError: true
      });
      // Optimistic local state update - avoids a full re-fetch
      const state = useGlobalConfigStore.getState();
      const updatedProviders = state.providers.map(p =>
        p.id === id ? { ...p, active, enabled: active } : p
      );
      useGlobalConfigStore.setState({
        providers: updatedProviders,
        activeProviders: updatedProviders.filter(p => p.enabled && p.active),
      });
    } catch (error) {
      console.error("Failed to toggle provider:", error);
      throw error;
    }
  },

  updateProvider: async (id: string, data: any) => {
    try {
      const response = await apiClient<{ success: boolean; provider: Provider }>(`/api/providers/${id}`, {
        method: "PUT",
        body: data,
        showLoader: "Actualizando proveedor...",
        showError: true,
        showSuccess: "Proveedor actualizado"
      });
      // Patch local state with returned provider — no full re-fetch needed
      if (response?.provider) {
        const state = useGlobalConfigStore.getState();
        const updatedProviders = state.providers.map(p =>
          p.id === id ? { ...p, ...response.provider } : p
        );
        useGlobalConfigStore.setState({
          providers: updatedProviders,
          activeProviders: updatedProviders.filter(p => p.enabled && p.active),
        });
      }
    } catch (error) {
      console.error("Failed to update provider:", error);
      throw error;
    }
  },
});

// ==================== MODELS ====================
interface ModelsState {
  models: Model[];
  availableModels: Model[];
  fetchModels: () => Promise<void>;
  toggleModel: (id: string, active: boolean) => Promise<void>;
  createModel: (providerId: string, name: string) => Promise<void>;
  syncModels: (providerId: string) => Promise<{ synced: number }>;
  getModelsByProvider: (providerId: string) => Model[];
  deleteModel: (id: string) => Promise<void>;
  updateModel: (id: string, data: { name?: string; id?: string }) => Promise<void>;
}

const createModelsSlice = () => ({
  models: [] as Model[],
  availableModels: [] as Model[],

  fetchModels: async () => {
    try {
      const response = await apiClient<{ models: Model[] }>("/api/models");
      const models = response.models;
      return {
        models,
        availableModels: models.filter(m => m.enabled || m.active),
      };
    } catch (error) {
      console.error("Failed to fetch models:", error);
      return { models: [], availableModels: [] };
    }
  },

  toggleModel: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/models/${id}/toggle`, {
        method: "POST",
        body: { active },
        showLoader: active ? "Activando modelo..." : "Desactivando modelo...",
        showError: true
      });
      // Update local state immediately for responsive UI
      const state = useGlobalConfigStore.getState();
      const updatedModels = state.models.map(m =>
        m.id === id ? { ...m, active, enabled: active } : m
      );
      useGlobalConfigStore.setState({
        models: updatedModels,
        availableModels: updatedModels.filter(m => m.enabled || m.active),
      });
    } catch (error) {
      console.error("Failed to toggle model:", error);
      throw error;
    }
  },

  syncModels: async (providerId: string) => {
    try {
      const response = await apiClient<{ success: boolean; synced: number; models: Model[] }>(
        `/api/providers/${providerId}/sync-models`,
        {
          method: "POST",
          showLoader: "Sincronizando modelos desde Ollama...",
          showError: true,
          showSuccess: (r: any) => `${r.synced} modelos sincronizados`,
        }
      );
      // Patch local models state with the synced list
      const state = useGlobalConfigStore.getState();
      const otherModels = state.models.filter(m => (m.provider_id || m.providerId) !== providerId);
      const updatedModels = [...otherModels, ...(response.models || [])];
      useGlobalConfigStore.setState({
        models: updatedModels,
        availableModels: updatedModels.filter(m => m.enabled || m.active),
      });
      return { synced: response.synced };
    } catch (error) {
      console.error("Failed to sync models:", error);
      throw error;
    }
  },

  createModel: async (providerId: string, name: string) => {
    try {
      const response = await apiClient<{ ok: boolean; id: string; model: any }>("/api/models", {
        method: "POST",
        body: { provider_id: providerId, name },
        showLoader: "Agregando modelo...",
        showError: true,
        showSuccess: "Modelo agregado"
      });
      if (response?.model) {
        const state = useGlobalConfigStore.getState();
        const updatedModels = [...state.models, response.model];
        useGlobalConfigStore.setState({
          models: updatedModels,
          availableModels: updatedModels.filter(m => m.enabled || m.active),
        });
      } else {
        const data = await createModelsSlice().fetchModels();
        useGlobalConfigStore.setState(data);
      }
    } catch (error) {
      console.error("Failed to create model:", error);
      throw error;
    }
  },

  getModelsByProvider: (providerId: string) => {
    const { models } = useGlobalConfigStore.getState();
    return models.filter((m) => {
      const mProviderId = m.providerId || m.provider_id;
      return mProviderId === providerId && (m.enabled || m.active);
    });
  },

  deleteModel: async (id: string) => {
    try {
      await apiClient(`/api/models/${encodeURIComponent(id)}`, {
        method: "DELETE",
        showLoader: "Eliminando modelo...",
        showError: true,
        showSuccess: "Modelo eliminado"
      });
      const state = useGlobalConfigStore.getState();
      const updatedModels = state.models.filter(m => m.id !== id);
      useGlobalConfigStore.setState({
        models: updatedModels,
        availableModels: updatedModels.filter(m => m.enabled || m.active),
      });
    } catch (error) {
      console.error("Failed to delete model:", error);
      throw error;
    }
  },

  updateModel: async (id: string, data: { name?: string; id?: string }) => {
    try {
      const response = await apiClient<{ ok: boolean; model: any }>(`/api/models/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: data,
        showLoader: "Actualizando modelo...",
        showError: true,
        showSuccess: "Modelo actualizado"
      });
      if (response?.model) {
        const state = useGlobalConfigStore.getState();
        const updatedModels = state.models.map(m =>
          m.id === id ? { ...m, ...response.model } : m
        );
        useGlobalConfigStore.setState({
          models: updatedModels,
          availableModels: updatedModels.filter(m => m.enabled || m.active),
        });
      }
    } catch (error) {
      console.error("Failed to update model:", error);
      throw error;
    }
  },
});

// ==================== AGENTS ====================
interface AgentsState {
  agents: Agent[];
  isLoading: boolean;
  fetchAgents: () => Promise<void>;
  createAgent: (data: any) => Promise<Agent>;
  updateAgent: (id: string, data: any) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

const createAgentsSlice = () => ({
  agents: [] as Agent[],
  isLoading: false,

  fetchAgents: async () => {
    try {
      const response = await apiClient<{ agents: Agent[] }>("/api/agents");
      return { agents: response.agents };
    } catch (error) {
      console.error("Failed to fetch agents:", error);
      return { agents: [] };
    }
  },

  createAgent: async (data: any) => {
    try {
      const response = await apiClient<{ agent: Agent }>("/api/agents", {
        method: "POST",
        body: data,
        showLoader: "Creando agente...",
        showError: true,
        showSuccess: "Agente creado con éxito"
      });

      const { fetchAgents } = useGlobalConfigStore.getState();
      await fetchAgents();

      return response.agent;
    } catch (error) {
      console.error("Failed to create agent:", error);
      throw error;
    }
  },

  updateAgent: async (id: string, data: any) => {
    try {
      await apiClient(`/api/agents/${id}`, {
        method: "PUT",
        body: data,
        showLoader: "Guardando cambios...",
        showError: true,
        showSuccess: "Perfil del agente sincronizado"
      });

      const { fetchAgents } = useGlobalConfigStore.getState();
      await fetchAgents();
    } catch (error) {
      console.error("Failed to update agent:", error);
      throw error;
    }
  },

  deleteAgent: async (id: string) => {
    try {
      await apiClient(`/api/agents/${id}`, {
        method: "DELETE",
        showLoader: "Eliminando agente...",
        showError: true,
        showSuccess: "Agente eliminado"
      });

      const { fetchAgents } = useGlobalConfigStore.getState();
      await fetchAgents();
    } catch (error) {
      console.error("Failed to delete agent:", error);
      throw error;
    }
  },
});

// ==================== TOOLS ====================
interface ToolsState {
  tools: Array<{ id: string; name: string; description: string; category: string; enabled: boolean; active: boolean }>;
  activeTools: Array<{ id: string; name: string; description: string; category: string }>;
  fetchTools: () => Promise<void>;
  toggleTool: (id: string, active: boolean) => Promise<void>;
  updateTool: (id: string, data: Partial<Tool>) => Promise<void>;
}

const createToolsSlice = () => ({
  tools: [] as Array<{ id: string; name: string; description: string; category: string; enabled: boolean; active: boolean }>,
  activeTools: [] as Array<{ id: string; name: string; description: string; category: string }>,

  fetchTools: async () => {
    try {
      const response = await apiClient<{ tools: Array<{ id: string; name: string; description: string; category: string; enabled: boolean; active: boolean }> }>("/api/tools");
      const tools = response.tools;
      return {
        tools,
        activeTools: tools.filter(t => t.active).map(t => ({ id: t.id, name: t.name, description: t.description, category: t.category })),
      };
    } catch (error) {
      console.error("Failed to fetch tools:", error);
      return { tools: [], activeTools: [] };
    }
  },

  toggleTool: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/tools/${id}/toggle`, {
        method: "POST",
        body: { active },
      });
      // Actualizar estado local inmediatamente
      const state = useGlobalConfigStore.getState();
      const currentTools = state.tools.map(t =>
        t.id === id ? { ...t, active } : t
      );
      useGlobalConfigStore.setState({
        tools: currentTools,
        activeTools: currentTools.filter(t => t.active).map(t => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
      });
    } catch (error) {
      console.error("Failed to toggle tool:", error);
      throw error;
    }
  },

  updateTool: async (id: string, data: Partial<Tool>) => {
    try {
      await apiClient(`/api/tools/${id}`, {
        method: "PUT",
        body: data,
      });
      // Actualizar estado local
      const state = useGlobalConfigStore.getState();
      const currentTools = state.tools.map(t =>
        t.id === id ? { ...t, ...data } : t
      );
      useGlobalConfigStore.setState({
        tools: currentTools,
        activeTools: currentTools.filter(t => t.active).map(t => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
      });
    } catch (error) {
      console.error("Failed to update tool:", error);
      throw error;
    }
  },
});

// ==================== SKILLS ====================
interface SkillsState {
  skills: Skill[];
  activeSkills: Skill[];
  fetchSkills: () => Promise<void>;
  toggleSkill: (id: string, active: boolean) => Promise<void>;
  updateSkill: (id: string, data: Partial<Skill>) => Promise<void>;
}

const createSkillsSlice = () => ({
  skills: [] as Skill[],
  activeSkills: [] as Skill[],

  fetchSkills: async () => {
    try {
      const response = await apiClient<{ skills: Skill[] }>("/api/skills");
      const skills = response.skills;
      return {
        skills,
        activeSkills: skills.filter(s => s.active),
      };
    } catch (error) {
      console.error("Failed to fetch skills:", error);
      return { skills: [], activeSkills: [] };
    }
  },

  toggleSkill: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/skills/${id}/toggle`, {
        method: "POST",
        body: { active },
      });
    } catch (error) {
      console.error("Failed to toggle skill:", error);
      throw error;
    }
  },

  updateSkill: async (id: string, data: Partial<Skill>) => {
    try {
      await apiClient(`/api/skills/${id}`, {
        method: "PUT",
        body: data,
      });
    } catch (error) {
      console.error("Failed to update skill:", error);
      throw error;
    }
  },
});

// ==================== MCP SERVERS ====================
interface MCPServerConfig {
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

interface MCPServersState {
  servers: Array<{ id: string; name: string; transport: string; status: string; enabled: boolean; active: boolean; builtin: boolean }>;
  activeServers: Array<{ id: string; name: string; transport: string; status: string }>;
  fetchMCPServers: () => Promise<void>;
  toggleMCPServer: (id: string, active: boolean) => Promise<void>;
  updateMCPServer: (id: string, config: MCPServerConfig) => Promise<void>;
  deleteMCPServer: (id: string) => Promise<void>;
}

const createMCPServersSlice = () => ({
  servers: [] as Array<{ id: string; name: string; transport: string; status: string; enabled: boolean; active: boolean; builtin: boolean }>,
  activeServers: [] as Array<{ id: string; name: string; transport: string; status: string }>,

  fetchMCPServers: async () => {
    try {
      const response = await apiClient<any[]>("/api/mcp/servers");

      // Flatten configuration from backend structure
      const servers = response.map(s => {
        const config = s.config || {};
        return {
          id: s.id || s.name,
          name: s.name,
          status: s.status,
          enabled: s.enabled,
          active: s.enabled && s.status === "connected",
          builtin: s.builtin || false,
          transport: config.transport || "stdio",
          command: config.command,
          args: config.args,
          url: config.url,
          tools_count: s.tools_count || 0,
          tools: s.tools || []
        };
      });

      return {
        servers,
        activeServers: servers.filter(s => s.active).map(s => ({
          id: s.id,
          name: s.name,
          transport: s.transport,
          status: s.status
        })),
      };
    } catch (error) {
      console.error("Failed to fetch MCP servers:", error);
      return { servers: [], activeServers: [] };
    }
  },

  toggleMCPServer: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/mcp/servers/${id}`, {
        method: "POST",
        body: { action: active ? "connect" : "disconnect" },
        showLoader: active ? "Conectando servidor..." : "Desconectando servidor...",
        showError: true,
        showSuccess: active ? "Servidor conectado" : "Servidor desconectado"
      });
      // Force refresh or update local state
      const { fetchMCPServers } = useGlobalConfigStore.getState();
      await fetchMCPServers();
    } catch (error) {
      console.error("Failed to toggle MCP server:", error);
      throw error;
    }
  },

  updateMCPServer: async (id: string, config: MCPServerConfig) => {
    try {
      await apiClient(`/api/mcp/servers/${id}`, {
        method: "PUT",
        body: config,
        showLoader: "Guardando configuración...",
        showError: true,
        showSuccess: "Configuración guardada"
      });
      const { fetchMCPServers } = useGlobalConfigStore.getState();
      await fetchMCPServers();
    } catch (error) {
      console.error("Failed to update MCP server:", error);
      throw error;
    }
  },

  deleteMCPServer: async (id: string) => {
    try {
      await apiClient(`/api/mcp/servers/${id}`, {
        method: "DELETE",
        showLoader: "Eliminando servidor...",
        showError: true,
        showSuccess: "Servidor eliminado"
      });
      // Actualizar estado local
      const state = useGlobalConfigStore.getState();
      const currentServers = state.servers.filter(s => s.id !== id);
      useGlobalConfigStore.setState({
        servers: currentServers,
        activeServers: currentServers.filter(s => s.active).map(s => ({ id: s.id, name: s.name, transport: s.transport, status: s.status }))
      });
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
      throw error;
    }
  },
});

// ==================== CHANNELS ====================
interface ChannelsState {
  channels: ConnectedChannel[];
  activeChannels: ConnectedChannel[];
  fetchChannels: () => Promise<void>;
  toggleChannel: (id: string, active: boolean) => Promise<void>;
  updateChannel: (id: string, data: Partial<ConnectedChannel>) => Promise<void>;
}

const createChannelsSlice = () => ({
  channels: [] as ConnectedChannel[],
  activeChannels: [] as ConnectedChannel[],

  fetchChannels: async () => {
    try {
      const response = await apiClient<{ channels: ConnectedChannel[] }>("/api/channels");
      const channels = response.channels;
      return {
        channels,
        activeChannels: channels.filter(c => c.active),
      };
    } catch (error) {
      console.error("Failed to fetch channels:", error);
      return { channels: [], activeChannels: [] };
    }
  },

  toggleChannel: async (id: string, active: boolean) => {
    try {
      await apiClient(`/api/channels/${id}/toggle`, {
        method: "POST",
        body: { active },
      });
    } catch (error) {
      console.error("Failed to toggle channel:", error);
      throw error;
    }
  },

  updateChannel: async (id: string, data: Partial<ConnectedChannel>) => {
    try {
      await apiClient(`/api/channels/${id}`, {
        method: "PUT",
        body: data,
      });
      // Refresh channels after update
      const { fetchChannels } = useGlobalConfigStore.getState();
      await fetchChannels();
    } catch (error) {
      console.error("Failed to update channel:", error);
      throw error;
    }
  },
});

// ==================== VOICE ====================
interface VoiceState {
  voiceProviders: string[];
  configuredVoiceProviders: Record<string, boolean>;
  fetchVoiceProviders: () => Promise<{ voiceProviders: string[]; configuredVoiceProviders: Record<string, boolean> }>;
  fetchConfiguredVoiceProviders: () => Promise<{ configuredVoiceProviders: Record<string, boolean> }>;
  saveVoiceProviderKey: (providerId: string, apiKey: string) => Promise<void>;
}

const createVoiceSlice = () => ({
  voiceProviders: [] as string[],
  configuredVoiceProviders: {} as Record<string, boolean>,

  fetchVoiceProviders: async () => {
    try {
      const response = await apiClient<{ providers: string[] }>("/api/voice/providers");
      return {
        voiceProviders: response.providers,
        configuredVoiceProviders: {},
      };
    } catch (error) {
      console.error("Failed to fetch voice providers:", error);
      return { voiceProviders: [], configuredVoiceProviders: {} };
    }
  },

  fetchConfiguredVoiceProviders: async () => {
    try {
      const response = await apiClient<Record<string, boolean>>("/api/voice/configured-providers");
      return {
        configuredVoiceProviders: response,
      };
    } catch (error) {
      console.error("Failed to fetch configured voice providers:", error);
      return { configuredVoiceProviders: {} };
    }
  },

  saveVoiceProviderKey: async (providerId: string, apiKey: string) => {
    try {
      await apiClient(`/api/voice/providers/${providerId}/key`, {
        method: "POST",
        body: { apiKey },
      });
      // Refresh configured providers after saving
      const configuredData = await createVoiceSlice().fetchConfiguredVoiceProviders();
      set(configuredData);
    } catch (error) {
      console.error("Failed to save voice provider key:", error);
      throw error;
    }
  },
});


// ==================== GLOBAL STORE ====================
type GlobalConfigState = ProvidersState & ModelsState & AgentsState & ToolsState & SkillsState & MCPServersState & ChannelsState & VoiceState & {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  fetchAll: () => Promise<void>;
  refresh: (entity: string) => Promise<void>;
};

export const useGlobalConfigStore = create<GlobalConfigState>((set, get) => ({
  // Providers
  providers: [],
  activeProviders: [],

  // Models
  models: [],
  availableModels: [],

  // Agents
  agents: [],

  // Tools
  tools: [],
  activeTools: [],

  // Skills
  skills: [],
  activeSkills: [],

  // MCP Servers
  servers: [],
  activeServers: [],

  // Channels
  channels: [],
  activeChannels: [],

  // Voice
  voiceProviders: [],
  configuredVoiceProviders: {},

  // State
  isLoading: false,
  isInitialized: false,
  error: null,

  fetchAll: async () => {
    if (get().isInitialized) return;

    const { showLoader, hideLoader } = (await import("@/stores/useLoaderStore")).useLoaderStore.getState();
    showLoader("Sincronizando la Colmena...");

    set({ isLoading: true, error: null });

    try {
      // Fetch all in parallel
      const [
        providersData,
        modelsData,
        agentsData,
        toolsData,
        skillsData,
        mcpData,
        channelsData,
        voiceData,
      ] = await Promise.all([
        createProvidersSlice().fetchProviders(),
        createModelsSlice().fetchModels(),
        createAgentsSlice().fetchAgents(),
        createToolsSlice().fetchTools(),
        createSkillsSlice().fetchSkills(),
        createMCPServersSlice().fetchMCPServers(),
        createChannelsSlice().fetchChannels(),
        createVoiceSlice().fetchVoiceProviders(),
      ]);

      // Also fetch configured voice providers (depends on voice providers being loaded)
      const configuredVoiceData = await createVoiceSlice().fetchConfiguredVoiceProviders();

      set({
        ...providersData,
        ...modelsData,
        ...agentsData,
        ...toolsData,
        ...skillsData,
        ...mcpData,
        ...channelsData,
        ...voiceData,
        ...configuredVoiceData,
        isLoading: false,
        isInitialized: true,
      });
      hideLoader();
    } catch (error) {
      hideLoader();
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to fetch config",
      });
    }
  },

  refresh: async (entity: string) => {
    try {
      let data: any;
      switch (entity) {
        case "providers":
          data = await createProvidersSlice().fetchProviders();
          set(data);
          break;
        case "models":
          data = await createModelsSlice().fetchModels();
          set(data);
          break;
        case "agents":
          data = await createAgentsSlice().fetchAgents();
          set(data);
          break;
        case "tools": {
          const toolsData = await createToolsSlice().fetchTools();
          if (toolsData) set(toolsData);
          break;
        }
        case "skills":
          data = await createSkillsSlice().fetchSkills();
          set(data);
          break;
        case "mcp":
          data = await createMCPServersSlice().fetchMCPServers();
          set(data);
          break;
        case "channels":
          data = await createChannelsSlice().fetchChannels();
          set(data);
          break;
      }
    } catch (error) {
      console.error(`Failed to refresh ${entity}:`, error);
    }
  },

  // Providers methods
  fetchProviders: async () => {
    const data = await createProvidersSlice().fetchProviders();
    set(data);
  },
  toggleProvider: createProvidersSlice().toggleProvider,
  updateProvider: createProvidersSlice().updateProvider,

  // Models methods
  fetchModels: async () => {
    const data = await createModelsSlice().fetchModels();
    set(data);
  },
  toggleModel: createModelsSlice().toggleModel,
  createModel: createModelsSlice().createModel,
  syncModels: createModelsSlice().syncModels,
  getModelsByProvider: createModelsSlice().getModelsByProvider,
  deleteModel: createModelsSlice().deleteModel,
  updateModel: createModelsSlice().updateModel,

  // Agents methods
  fetchAgents: async () => {
    const data = await createAgentsSlice().fetchAgents();
    set(data);
  },
  createAgent: createAgentsSlice().createAgent,
  updateAgent: createAgentsSlice().updateAgent,
  deleteAgent: createAgentsSlice().deleteAgent,

  // Tools methods
  fetchTools: async () => {
    const data = await createToolsSlice().fetchTools();
    if (data) set(data);
  },
  toggleTool: createToolsSlice().toggleTool,
  updateTool: createToolsSlice().updateTool,

  // Skills methods
  fetchSkills: async () => {
    const data = await createSkillsSlice().fetchSkills();
    set(data);
  },
  toggleSkill: createSkillsSlice().toggleSkill,
  updateSkill: createSkillsSlice().updateSkill,

  // MCP methods
  fetchMCPServers: async () => {
    const data = await createMCPServersSlice().fetchMCPServers();
    set(data);
  },
  toggleMCPServer: createMCPServersSlice().toggleMCPServer,
  updateMCPServer: createMCPServersSlice().updateMCPServer,
  deleteMCPServer: createMCPServersSlice().deleteMCPServer,

  // Channels methods
  fetchChannels: async () => {
    const data = await createChannelsSlice().fetchChannels();
    set(data);
  },
  toggleChannel: createChannelsSlice().toggleChannel,
  updateChannel: createChannelsSlice().updateChannel,

  // Voice methods
  fetchVoiceProviders: async () => {
    const data = await createVoiceSlice().fetchVoiceProviders();
    set(data);
  },
  fetchConfiguredVoiceProviders: async () => {
    const data = await createVoiceSlice().fetchConfiguredVoiceProviders();
    set(data);
  },
  saveVoiceProviderKey: async (providerId: string, apiKey: string) => {
    await apiClient(`/api/voice/providers/${providerId}/key`, {
      method: "POST",
      body: { apiKey },
    });
    const data = await createVoiceSlice().fetchConfiguredVoiceProviders();
    set(data);
  },

}));

/**
 * Hook para inicializar toda la configuración global al montar la app
 */
export function useInitializeGlobalConfig() {
  const fetchAll = useGlobalConfigStore((state) => state.fetchAll);
  const isInitialized = useGlobalConfigStore((state) => state.isInitialized);

  const hasRun = React.useRef(false);

  React.useEffect(() => {
    if (!isInitialized && !hasRun.current) {
      hasRun.current = true;
      fetchAll();
    }
  }, [isInitialized, fetchAll]);
}

/**
 * Hooks específicos por entidad para usar en componentes
 */
export function useProviders() {
  const providers = useGlobalConfigStore((state) => state.providers);
  const activeProviders = useGlobalConfigStore((state) => state.activeProviders);
  const models = useGlobalConfigStore((state) => state.models);
  const availableModels = useGlobalConfigStore((state) => state.availableModels);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchProviders = useGlobalConfigStore((state) => state.fetchProviders);
  const fetchModels = useGlobalConfigStore((state) => state.fetchModels);
  const toggleProvider = useGlobalConfigStore((state) => state.toggleProvider);
  const updateProvider = useGlobalConfigStore((state) => state.updateProvider);
  const getModelsByProvider = useGlobalConfigStore((state) => state.getModelsByProvider);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    providers,
    activeProviders,
    models,
    availableModels,
    isLoading,
    error,
    fetchProviders,
    fetchModels,
    toggleProvider,
    updateProvider,
    getModelsByProvider,
  };
}

export function useModels() {
  const models = useGlobalConfigStore((state) => state.models);
  const availableModels = useGlobalConfigStore((state) => state.availableModels);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchModels = useGlobalConfigStore((state) => state.fetchModels);
  const toggleModel = useGlobalConfigStore((state) => state.toggleModel);
  const createModel = useGlobalConfigStore((state) => state.createModel);
  const syncModels = useGlobalConfigStore((state) => state.syncModels);
  const getModelsByProvider = useGlobalConfigStore((state) => state.getModelsByProvider);
  const deleteModel = useGlobalConfigStore((state) => state.deleteModel);
  const updateModel = useGlobalConfigStore((state) => state.updateModel);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    models,
    availableModels,
    isLoading,
    error,
    fetchModels,
    toggleModel,
    createModel,
    syncModels,
    getModelsByProvider,
    deleteModel,
    updateModel,
  };
}

export function useAgents() {
  const agents = useGlobalConfigStore((state) => state.agents);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchAgents = useGlobalConfigStore((state) => state.fetchAgents);
  const createAgent = useGlobalConfigStore((state) => state.createAgent);
  const updateAgent = useGlobalConfigStore((state) => state.updateAgent);
  const deleteAgent = useGlobalConfigStore((state) => state.deleteAgent);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    agents,
    isLoading,
    error,
    fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent,
  };
}

export function useTools() {
  const tools = useGlobalConfigStore((state) => state.tools);
  const activeTools = useGlobalConfigStore((state) => state.activeTools);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchTools = useGlobalConfigStore((state) => state.fetchTools);
  const toggleTool = useGlobalConfigStore((state) => state.toggleTool);
  const updateTool = useGlobalConfigStore((state) => state.updateTool);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    tools,
    activeTools,
    isLoading,
    error,
    fetchTools,
    toggleTool,
    updateTool,
  };
}

export function useSkills() {
  const skills = useGlobalConfigStore((state) => state.skills);
  const activeSkills = useGlobalConfigStore((state) => state.activeSkills);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchSkills = useGlobalConfigStore((state) => state.fetchSkills);
  const toggleSkill = useGlobalConfigStore((state) => state.toggleSkill);
  const updateSkill = useGlobalConfigStore((state) => state.updateSkill);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    skills,
    activeSkills,
    isLoading,
    error,
    fetchSkills,
    toggleSkill,
    updateSkill,
  };
}

export function useMCPServers() {
  const servers = useGlobalConfigStore((state) => state.servers);
  const activeServers = useGlobalConfigStore((state) => state.activeServers);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchMCPServers = useGlobalConfigStore((state) => state.fetchMCPServers);
  const toggleMCPServer = useGlobalConfigStore((state) => state.toggleMCPServer);
  const updateMCPServer = useGlobalConfigStore((state) => state.updateMCPServer);
  const deleteMCPServer = useGlobalConfigStore((state) => state.deleteMCPServer);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    servers,
    activeServers,
    isLoading,
    error,
    fetchMCPServers,
    toggleMCPServer,
    updateMCPServer,
    deleteMCPServer,
  };
}

export function useChannels() {
  const channels = useGlobalConfigStore((state) => state.channels);
  const activeChannels = useGlobalConfigStore((state) => state.activeChannels);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchChannels = useGlobalConfigStore((state) => state.fetchChannels);
  const toggleChannel = useGlobalConfigStore((state) => state.toggleChannel);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    channels,
    activeChannels,
    isLoading,
    error,
    fetchChannels,
    toggleChannel,
    updateChannel: useGlobalConfigStore((state) => state.updateChannel),
  };
}

export function useVoice() {
  const voiceProviders = useGlobalConfigStore((state) => state.voiceProviders);
  const configuredVoiceProviders = useGlobalConfigStore((state) => state.configuredVoiceProviders);
  const isLoading = useGlobalConfigStore((state) => state.isLoading);
  const fetchVoiceProviders = useGlobalConfigStore((state) => state.fetchVoiceProviders);
  const fetchConfiguredVoiceProviders = useGlobalConfigStore((state) => state.fetchConfiguredVoiceProviders);
  const saveVoiceProviderKey = useGlobalConfigStore((state) => state.saveVoiceProviderKey);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    voiceProviders,
    configuredVoiceProviders,
    isLoading,
    error,
    fetchVoiceProviders,
    fetchConfiguredVoiceProviders,
    saveVoiceProviderKey,
  };
}

