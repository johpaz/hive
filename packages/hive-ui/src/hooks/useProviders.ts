// Re-export from global store
export {
  useProviders,
  useModels,
  useAgents,
  useAgents as useAgentStore,  // Alias para compatibilidad
  useTools,
  useSkills,
  useMCPServers,
  useChannels,
  useChannels as useChannelStore,  // Alias para compatibilidad
  useVoice,
  useInitializeGlobalConfig,
  useGlobalConfigStore,
} from "@/stores/useGlobalConfigStore";
