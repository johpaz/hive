import { create } from "zustand";
import React from "react";
import type { Provider, Model, Agent, Tool, Skill, MCPServer, ConnectedChannel } from "@/types";
import { apiClient } from "@/lib/api";
import { useLoaderStore } from "@/stores/useLoaderStore";

// ==================== PROVIDERS ====================
interface ProvidersState {
  providers: Provider[];
  activeProviders: Provider[];
  isLoading: boolean;
  fetchProviders: () => Promise<void>;
  toggleProvider: (id: string, active: boolean) => Promise<void>;
  updateProvider: (id: string, data: any) => Promise<void>;
  createProvider: (data: { id: string; name: string; base_url?: string; api_key?: string; headers?: Record<string, string>; num_ctx?: number | null }) => Promise<void>;
}

const createProvidersSlice = (set: any, get: any) => ({
  providers: [] as Provider[],
  activeProviders: [] as Provider[],
  isLoading: false,

  fetchProviders: async () => {
    try {
      const response = await apiClient<{ providers: Provider[] }>("/api/providers");
      const providers = response.providers.map(p => ({
        ...p,
        // Ensure models inside provider are also normalized
        models: p.models?.map(m => ({
          ...m,
          providerId: m.providerId || m.provider_id || p.id,
          provider_id: m.provider_id || m.providerId || p.id
        }))
      }));
      
      return {
        providers,
        activeProviders: providers.filter(p => p.enabled || p.active),
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
      
      // Refresh the entire state to ensure models are also updated (cascade)
      await get().fetchAll(true); // Force refresh
    } catch (error) {
      console.error("Failed to toggle provider:", error);
      throw error;
    }
  },

  updateProvider: async (id: string, data: any) => {
    try {
      await apiClient<{ success: boolean; provider: Provider }>(`/api/providers/${id}`, {
        method: "PUT",
        body: data,
        showLoader: "Actualizando proveedor...",
        showError: true,
        showSuccess: "Proveedor actualizado"
      });
      
      // Refresh the entire state to ensure consistency (especially for enabled/active cascade)
      await get().fetchAll(true); // Force refresh
    } catch (error) {
      console.error("Failed to update provider:", error);
      throw error;
    }
  },

  createProvider: async (data: { id: string; name: string; base_url?: string; api_key?: string; headers?: Record<string, string>; num_ctx?: number | null }) => {
    try {
      // Step 1: Create the provider basic info
      await apiClient<{ ok: boolean }>("/api/providers", {
        method: "POST",
        body: {
          id: data.id,
          name: data.name,
          base_url: data.base_url || null,
          enabled: 1,
        },
        showLoader: "Añadiendo proveedor...",
        showError: true,
      });

      // Step 2: Update with API key, headers, and num_ctx if provided
      const updateData: Record<string, unknown> = {};
      if (data.api_key) {
        updateData.apiKey = data.api_key;
      }
      if (data.headers) {
        updateData.headers = data.headers;
      }
      if (data.num_ctx !== undefined && data.num_ctx !== null) {
        updateData.num_ctx = data.num_ctx;
      }

      if (Object.keys(updateData).length > 0) {
        await apiClient<{ ok: boolean }>(`/api/providers/${data.id}`, {
          method: "PUT",
          body: updateData,
          showLoader: "Configurando proveedor...",
          showError: true,
        });
      }

      // Step 3: Re-fetch providers to update the list
      const result = await get().fetchProvidersInternal();
      set(result);
    } catch (error) {
      console.error("Failed to create provider:", error);
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
  loadHiveAgentsModel: (modelId: string, ctx?: number) => Promise<{ success: boolean; loading: boolean; model_id?: string; ctx?: number }>;
  getHiveAgentsModelStatus: () => Promise<{ success: boolean; loaded: boolean; model?: { name?: string; ctx?: number } }>;
}

const createModelsSlice = (set: any, get: any) => ({
  models: [] as Model[],
  availableModels: [] as Model[],

  fetchModels: async () => {
    try {
      const response = await apiClient<{ models: Model[] }>("/api/models");
      const models = response.models.map(m => ({
        ...m,
        providerId: m.providerId || m.provider_id,
        provider_id: m.provider_id || m.providerId
      }));
      const availableModels = get().filterModelsByProviderStatus(models, get().providers);
      return {
        models,
        availableModels,
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
      const state = get();
      const updatedModels = state.models.map(m =>
        m.id === id ? { ...m, active, enabled: active } : m
      );
      const availableModels = get().filterModelsByProviderStatus(updatedModels, state.providers);
      set({
        models: updatedModels,
        availableModels,
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
      const state = get();
      const otherModels = state.models.filter((m: any) => (m.provider_id || m.providerId) !== providerId);
      const normalizedNewModels = (response.models || []).map((m: any) => ({
        ...m,
        providerId: m.providerId || m.provider_id,
        provider_id: m.provider_id || m.providerId
      }));
      const updatedModels = [...otherModels, ...normalizedNewModels];
      const availableModels = get().filterModelsByProviderStatus(updatedModels, get().providers);
      set({
        models: updatedModels,
        availableModels,
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
        const state = get();
        const updatedModels = [...state.models, response.model].map(m => ({
          ...m,
          providerId: m.providerId || m.provider_id,
          provider_id: m.provider_id || m.providerId
        }));
        const availableModels = get().filterModelsByProviderStatus(updatedModels, state.providers);
        set({
          models: updatedModels,
          availableModels,
        });
      } else {
        const data = await get().fetchModelsInternal();
        set(data);
      }
    } catch (error) {
      console.error("Failed to create model:", error);
      throw error;
    }
  },

  getModelsByProvider: (providerId: string) => {
    const { models } = get();
    return models.filter((m: any) => {
      const mProviderId = m.providerId || m.provider_id;
      return mProviderId === providerId;
    });
  },

  loadHiveAgentsModel: async (modelId: string, ctx = 50000) => {
    return await apiClient<{ success: boolean; loading: boolean; model_id?: string; ctx?: number }>(
      "/api/providers/hiveagents/load-model",
      {
        method: "POST",
        body: { model_id: modelId, ctx },
        showLoader: false,
        showError: true,
      }
    );
  },

  getHiveAgentsModelStatus: async () => {
    return await apiClient<{
      success: boolean;
      loaded: boolean;
      model?: { name?: string; ctx?: number };
    }>("/api/providers/hiveagents/model-status", {
      method: "GET",
      showLoader: false,
      showError: false,
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
      const state = get();
      const updatedModels = state.models.filter((m: any) => m.id !== id);
      const availableModels = get().filterModelsByProviderStatus(updatedModels, state.providers);
      set({
        models: updatedModels,
        availableModels,
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
        const state = get();
        const updatedModels = state.models.map((m: any) =>
          m.id === id ? { ...m, ...response.model } : m
        );
        const availableModels = get().filterModelsByProviderStatus(updatedModels, state.providers);
        set({
          models: updatedModels,
          availableModels,
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

const createAgentsSlice = (set: any, get: any) => ({
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

      const agentsData = await get().fetchAgentsInternal();
      set(agentsData);

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

      const agentsData = await get().fetchAgentsInternal();
      set(agentsData);
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

      const data = await get().fetchAgentsInternal();
      set(data);
    } catch (error) {
      console.error("Failed to delete agent:", error);
      throw error;
    }
  },
});

// ==================== TOOLS ====================
type StoreTool = { id: string; name: string; description: string; category: string; enabled: boolean; active: boolean; core?: boolean };

interface ToolsState {
  tools: StoreTool[];
  activeTools: Array<{ id: string; name: string; description: string; category: string }>;
  fetchTools: () => Promise<void>;
  toggleTool: (id: string, active: boolean) => Promise<void>;
  updateTool: (id: string, data: Partial<Tool>) => Promise<void>;
}

const createToolsSlice = (set: any, get: any) => ({
  tools: [] as StoreTool[],
  activeTools: [] as Array<{ id: string; name: string; description: string; category: string }>,

  fetchTools: async () => {
    try {
      const response = await apiClient<{ tools: StoreTool[] }>("/api/tools");
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
    // Guardar estado anterior para posible rollback
    const state = get();
    const previousTools = state.tools;

    // Actualización optimista
    const updatedTools = state.tools.map((t: any) =>
      t.id === id ? { ...t, active } : t
    );
    set({
      tools: updatedTools,
      activeTools: updatedTools.filter((t: any) => t.active).map((t: any) => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
    });

    try {
      await apiClient(`/api/tools/${id}/toggle`, {
        method: "POST",
        body: { active },
      });
    } catch (error) {
      // Revertir al estado anterior si la API falla
      set({
        tools: previousTools,
        activeTools: previousTools.filter((t: any) => t.active).map((t: any) => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
      });
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
      const state = get();
      const currentTools = state.tools.map((t: any) =>
        t.id === id ? { ...t, ...data } : t
      );
      set({
        tools: currentTools,
        activeTools: currentTools.filter((t: any) => t.active).map((t: any) => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
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

const createSkillsSlice = (set: any, get: any) => ({
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

const createMCPServersSlice = (set: any, get: any) => ({
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
      const data = await get().fetchMCPServersInternal();
      set(data);
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
      const data = await get().fetchMCPServersInternal();
      set(data);
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
      const state = get();
      const currentServers = state.servers.filter((s: any) => s.id !== id);
      set({
        servers: currentServers,
        activeServers: currentServers.filter((s: any) => s.active).map((s: any) => ({ id: s.id, name: s.name, transport: s.transport, status: s.status }))
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
  createChannel: (type: string, config?: Record<string, unknown>) => Promise<{ id: string; status: string }>;
  reconnectChannel: (id: string, config?: Record<string, unknown>) => Promise<void>;
  toggleChannel: (id: string, active: boolean) => Promise<void>;
  updateChannel: (id: string, data: Partial<ConnectedChannel>) => Promise<void>;
}

const createChannelsSlice = (set: any, get: any) => ({
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

  createChannel: async (type: string, config?: Record<string, unknown>) => {
    const response = await apiClient<{ success: boolean; id: string; status: string }>("/api/channels", {
      method: "POST",
      body: { type, config: config || {} },
    });
    return { id: response.id, status: response.status };
  },

  reconnectChannel: async (id: string, config?: Record<string, unknown>) => {
    await apiClient(`/api/channels/${id}/reconnect`, {
      method: "POST",
      body: { config: config || {} },
    });
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
      const channelsData = await get().fetchChannelsInternal();
      set(channelsData);
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

const createVoiceSlice = (set: any, get: any) => ({
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
      const configuredData = await createVoiceSlice(set, get).fetchConfiguredVoiceProviders();
      set(configuredData);
    } catch (error) {
      console.error("Failed to save voice provider key:", error);
      throw error;
    }
  },
});


// ==================== LOCAL TTS SLICE ====================
export interface LocalTTSStatus {
  installed: boolean;
  piperExists: boolean;
  voiceExists: boolean;
  running: boolean;
  port: number;
  installing: boolean;
  voices?: string[];
}

export interface TTSModel {
  id: string;
  name: string;
  language: string;
  quality: "low" | "medium" | "high";
  size: string;
  modelUrl: string;
  configUrl: string;
  installed: boolean;
}

interface LocalTTSState {
  localTTS: LocalTTSStatus;
  availableTTSModels: TTSModel[];
  isDownloadingModel: boolean;
  downloadLogs: string[];
  fetchLocalTTSStatus: () => Promise<void>;
  installLocalTTS: () => Promise<void>;
  startLocalTTS: () => Promise<void>;
  stopLocalTTS: () => Promise<void>;
  fetchAvailableTTSModels: () => Promise<void>;
  downloadTTSModel: (modelId: string) => Promise<void>;
  fetchDownloadLogs: () => Promise<void>;
}

const DEFAULT_LOCAL_TTS: LocalTTSStatus = {
  installed: false,
  piperExists: false,
  voiceExists: false,
  running: false,
  port: 5500,
  installing: false,
  voices: [],
};

// ==================== GLOBAL STORE ====================
type GlobalConfigState = ProvidersState & ModelsState & AgentsState & ToolsState & SkillsState & MCPServersState & ChannelsState & VoiceState & LocalTTSState & {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  fetchAll: (force?: boolean) => Promise<void>;
  refresh: (entity: string) => Promise<void>;
  // Internal fetchers used by slice methods via get()
  fetchProvidersInternal: () => Promise<{ providers: Provider[]; activeProviders: Provider[] }>;
  fetchModelsInternal: () => Promise<{ models: Model[]; availableModels: Model[] }>;
  fetchAgentsInternal: () => Promise<{ agents: Agent[] }>;
  fetchToolsInternal: () => Promise<any>;
  fetchSkillsInternal: () => Promise<{ skills: Skill[]; activeSkills: Skill[] }>;
  fetchMCPServersInternal: () => Promise<any>;
  fetchChannelsInternal: () => Promise<{ channels: ConnectedChannel[]; activeChannels: ConnectedChannel[] }>;
  fetchVoiceProvidersInternal: () => Promise<any>;
  filterModelsByProviderStatus: (models: Model[], providers: Provider[]) => Model[];
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

  // Local TTS
  localTTS: DEFAULT_LOCAL_TTS,
  availableTTSModels: [],
  isDownloadingModel: false,
  downloadLogs: [],

  // Internal fetchers (helper methods to avoid recreating slices constantly)
  fetchProvidersInternal: async () => createProvidersSlice(set, get).fetchProviders(),
  fetchModelsInternal: async () => createModelsSlice(set, get).fetchModels(),
  fetchAgentsInternal: async () => createAgentsSlice(set, get).fetchAgents(),
  fetchToolsInternal: async () => createToolsSlice(set, get).fetchTools(),
  fetchSkillsInternal: async () => createSkillsSlice(set, get).fetchSkills(),
  fetchMCPServersInternal: async () => createMCPServersSlice(set, get).fetchMCPServers(),
  fetchChannelsInternal: async () => createChannelsSlice(set, get).fetchChannels(),
  fetchVoiceProvidersInternal: async () => createVoiceSlice(set, get).fetchVoiceProviders(),

  filterModelsByProviderStatus: (models: Model[], providers: Provider[]) => {
    const activeProviderIds = new Set(
      providers
        .filter(p => p.enabled && p.active)
        .map(p => p.id)
    );
    return models.filter(m => activeProviderIds.has(m.providerId || m.provider_id));
  },

  // State
  isLoading: false,
  isInitialized: false,
  error: null,

  fetchAll: async (force = false) => {
    if (get().isInitialized && !force) return;

    const { showLoader, hideLoader } = useLoaderStore.getState();
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
        get().fetchProvidersInternal(),
        get().fetchModelsInternal(),
        get().fetchAgentsInternal(),
        get().fetchToolsInternal(),
        get().fetchSkillsInternal(),
        get().fetchMCPServersInternal(),
        get().fetchChannelsInternal(),
        get().fetchVoiceProvidersInternal(),
      ]);

      // Merge provider models into the global models array.
      // Provider models take precedence over DB models.
      const mergedModels = [...modelsData.models];
      providersData.providers.forEach(p => {
        if (p.models && p.models.length > 0) {
          p.models.forEach(m => {
            const idx = mergedModels.findIndex(mm => mm.id === m.id);
            if (idx === -1) {
              mergedModels.push(m);
            } else {
              // Overwrite with provider version so dynamic activation is respected
              mergedModels[idx] = { ...mergedModels[idx], ...m };
            }
          });
        }
      });

      // Also fetch configured voice providers (depends on voice providers being loaded)
      const configuredVoiceData = await createVoiceSlice(set, get).fetchConfiguredVoiceProviders();

      set({
        ...providersData,
        ...modelsData,
        models: mergedModels,
        availableModels: get().filterModelsByProviderStatus(mergedModels, providersData.providers),
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
          data = await get().fetchProvidersInternal();
          set(data);
          break;
        case "models":
          data = await get().fetchModelsInternal();
          set(data);
          break;
        case "agents":
          data = await get().fetchAgentsInternal();
          set(data);
          break;
        case "tools": {
          const toolsData = await get().fetchToolsInternal();
          if (toolsData) set(toolsData);
          break;
        }
        case "skills":
          data = await get().fetchSkillsInternal();
          set(data);
          break;
        case "mcp":
          data = await get().fetchMCPServersInternal();
          set(data);
          break;
        case "channels":
          data = await get().fetchChannelsInternal();
          set(data);
          break;
      }
    } catch (error) {
      console.error(`Failed to refresh ${entity}:`, error);
    }
  },

  // Providers methods
  fetchProviders: async () => {
    const data = await get().fetchProvidersInternal();
    set(data);
  },
  toggleProvider: (...args: any[]) => (createProvidersSlice(set, get).toggleProvider as any)(...args),
  updateProvider: (...args: any[]) => (createProvidersSlice(set, get).updateProvider as any)(...args),
  createProvider: (...args: any[]) => (createProvidersSlice(set, get).createProvider as any)(...args),

  // Models methods
  fetchModels: async () => {
    const data = await get().fetchModelsInternal();
    set(data);
  },
  toggleModel: (...args: any[]) => (createModelsSlice(set, get).toggleModel as any)(...args),
  createModel: (...args: any[]) => (createModelsSlice(set, get).createModel as any)(...args),
  syncModels: (...args: any[]) => (createModelsSlice(set, get).syncModels as any)(...args),
  getModelsByProvider: (...args: any[]) => (createModelsSlice(set, get).getModelsByProvider as any)(...args),
  deleteModel: (...args: any[]) => (createModelsSlice(set, get).deleteModel as any)(...args),
  updateModel: (...args: any[]) => (createModelsSlice(set, get).updateModel as any)(...args),
  loadHiveAgentsModel: (...args: any[]) => (createModelsSlice(set, get).loadHiveAgentsModel as any)(...args),
  getHiveAgentsModelStatus: (...args: any[]) => (createModelsSlice(set, get).getHiveAgentsModelStatus as any)(...args),

  // Agents methods
  fetchAgents: async () => {
    const data = await get().fetchAgentsInternal();
    set(data);
  },
  createAgent: (...args: any[]) => (createAgentsSlice(set, get).createAgent as any)(...args),
  updateAgent: (...args: any[]) => (createAgentsSlice(set, get).updateAgent as any)(...args),
  deleteAgent: (...args: any[]) => (createAgentsSlice(set, get).deleteAgent as any)(...args),

  // Tools methods
  fetchTools: async () => {
    const data = await get().fetchToolsInternal();
    if (data) set(data);
  },
  toggleTool: (...args: any[]) => (createToolsSlice(set, get).toggleTool as any)(...args),
  updateTool: (...args: any[]) => (createToolsSlice(set, get).updateTool as any)(...args),

  // Skills methods
  fetchSkills: async () => {
    const data = await get().fetchSkillsInternal();
    set(data);
  },
  toggleSkill: (...args: any[]) => (createSkillsSlice(set, get).toggleSkill as any)(...args),
  updateSkill: (...args: any[]) => (createSkillsSlice(set, get).updateSkill as any)(...args),

  // MCP methods
  fetchMCPServers: async () => {
    const data = await get().fetchMCPServersInternal();
    set(data);
  },
  toggleMCPServer: (...args: any[]) => (createMCPServersSlice(set, get).toggleMCPServer as any)(...args),
  updateMCPServer: (...args: any[]) => (createMCPServersSlice(set, get).updateMCPServer as any)(...args),
  deleteMCPServer: (...args: any[]) => (createMCPServersSlice(set, get).deleteMCPServer as any)(...args),

  // Channels methods
  fetchChannels: async () => {
    const data = await get().fetchChannelsInternal();
    set(data);
  },
  createChannel: (...args: any[]) => (createChannelsSlice(set, get).createChannel as any)(...args),
  reconnectChannel: (...args: any[]) => (createChannelsSlice(set, get).reconnectChannel as any)(...args),
  toggleChannel: (...args: any[]) => (createChannelsSlice(set, get).toggleChannel as any)(...args),
  updateChannel: (...args: any[]) => (createChannelsSlice(set, get).updateChannel as any)(...args),

  // Voice methods
  fetchVoiceProviders: async () => {
    const data = await createVoiceSlice(set, get).fetchVoiceProviders();
    set(data);
    return data;
  },
  fetchConfiguredVoiceProviders: async () => {
    const data = await createVoiceSlice(set, get).fetchConfiguredVoiceProviders();
    set(data);
    return data;
  },
  saveVoiceProviderKey: async (providerId: string, apiKey: string) => {
    await apiClient(`/api/voice/providers/${providerId}/key`, {
      method: "POST",
      body: { apiKey },
    });
    const data = await createVoiceSlice(set, get).fetchConfiguredVoiceProviders();
    set(data);
  },

  // Local TTS methods
  fetchLocalTTSStatus: async () => {
    try {
      const data = await apiClient<LocalTTSStatus>("/api/tts-local/status");
      set({ localTTS: data });
    } catch {
      // Gateway no disponible aún — no modificar el estado
    }
  },
  installLocalTTS: async () => {
    await apiClient("/api/tts-local/install", { method: "POST" });
    set((state) => ({ localTTS: { ...state.localTTS, installing: true } }));
  },
  startLocalTTS: async () => {
    await apiClient("/api/tts-local/start", { method: "POST" });
    const data = await apiClient<LocalTTSStatus>("/api/tts-local/status");
    set({ localTTS: data });
  },
  stopLocalTTS: async () => {
    await apiClient("/api/tts-local/stop", { method: "POST" });
    const data = await apiClient<LocalTTSStatus>("/api/tts-local/status");
    set({ localTTS: data });
  },
  fetchAvailableTTSModels: async () => {
    try {
      const data = await apiClient<{ models: TTSModel[] }>("/api/tts-local/models");
      set({ availableTTSModels: data.models });
    } catch {
      // Ignore
    }
  },
  downloadTTSModel: async (modelId: string) => {
    await apiClient("/api/tts-local/models/download", { 
      method: "POST", 
      body: { modelId },
      showError: true,
      showSuccess: "Descarga iniciada",
    });
    set({ isDownloadingModel: true, downloadLogs: [] });
    // Poll status until download completes
    const pollInterval = setInterval(async () => {
      const statusData = await apiClient<LocalTTSStatus>("/api/tts-local/status");
      set({ localTTS: statusData });
      const logsData = await apiClient<{ logs: string[]; downloading: boolean }>("/api/tts-local/models/logs");
      set({ downloadLogs: logsData.logs, isDownloadingModel: logsData.downloading });
      if (!logsData.downloading) {
        clearInterval(pollInterval);
        await get().fetchAvailableTTSModels();
      }
    }, 2000);
  },
  fetchDownloadLogs: async () => {
    try {
      const data = await apiClient<{ logs: string[]; downloading: boolean }>("/api/tts-local/models/logs");
      set({ downloadLogs: data.logs, isDownloadingModel: data.downloading });
    } catch {
      // Ignore
    }
  },

}));

/**
 * Waits until /health returns { status: "ok" } (gateway fully initialized),
 * then calls fetchAll(). Retries every 2s while the gateway is starting.
 */
export function useInitializeGlobalConfig(enabled = true) {
  const fetchAll = useGlobalConfigStore((state) => state.fetchAll);
  const isInitialized = useGlobalConfigStore((state) => state.isInitialized);

  const hasRun = React.useRef(false);

  React.useEffect(() => {
    if (enabled && !isInitialized && !hasRun.current) {
      hasRun.current = true;
      fetchAll(); // fetchAll internally waits for /health status="ok"
    }
  }, [enabled, isInitialized, fetchAll]);
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
  const toggleModel = useGlobalConfigStore((state) => state.toggleModel);
  const updateProvider = useGlobalConfigStore((state) => state.updateProvider);
  const createProvider = useGlobalConfigStore((state) => state.createProvider);
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
    toggleModel,
    updateProvider,
    createProvider,
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
  const createChannel = useGlobalConfigStore((state) => state.createChannel);
  const reconnectChannel = useGlobalConfigStore((state) => state.reconnectChannel);
  const toggleChannel = useGlobalConfigStore((state) => state.toggleChannel);
  const error = useGlobalConfigStore((state) => state.error);

  return {
    channels,
    activeChannels,
    isLoading,
    error,
    fetchChannels,
    createChannel,
    reconnectChannel,
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

export function useLocalTTS() {
  const localTTS = useGlobalConfigStore((state) => state.localTTS);
  const availableTTSModels = useGlobalConfigStore((state) => state.availableTTSModels);
  const isDownloadingModel = useGlobalConfigStore((state) => state.isDownloadingModel);
  const downloadLogs = useGlobalConfigStore((state) => state.downloadLogs);
  const fetchLocalTTSStatus = useGlobalConfigStore((state) => state.fetchLocalTTSStatus);
  const installLocalTTS = useGlobalConfigStore((state) => state.installLocalTTS);
  const startLocalTTS = useGlobalConfigStore((state) => state.startLocalTTS);
  const stopLocalTTS = useGlobalConfigStore((state) => state.stopLocalTTS);
  const fetchAvailableTTSModels = useGlobalConfigStore((state) => state.fetchAvailableTTSModels);
  const downloadTTSModel = useGlobalConfigStore((state) => state.downloadTTSModel);
  const fetchDownloadLogs = useGlobalConfigStore((state) => state.fetchDownloadLogs);

  return { 
    localTTS, 
    availableTTSModels,
    isDownloadingModel,
    downloadLogs,
    fetchLocalTTSStatus, 
    installLocalTTS, 
    startLocalTTS, 
    stopLocalTTS,
    fetchAvailableTTSModels,
    downloadTTSModel,
    fetchDownloadLogs,
  };
}

