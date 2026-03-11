import { useEthicsStore } from "@/stores/ethicsStore";
import type { EthicsConfig } from "@/types";
import { useEffect, useState } from "react";

export function useEthics(agentId: string) {
  const configs = useEthicsStore((s) => s.configs);
  const conflicts = useEthicsStore((s) => s.conflicts);
  const isLoading = useEthicsStore((s) => s.isLoading);
  const error = useEthicsStore((s) => s.error);
  const fetchEthics = useEthicsStore((s) => s.fetchEthics);
  const fetchConfigs = useEthicsStore((s) => s.fetchConfigs);
  const fetchConflicts = useEthicsStore((s) => s.fetchConflicts);
  const saveEthics = useEthicsStore((s) => s.saveEthics);
  const updateConfig = useEthicsStore((s) => s.updateConfig);
  const addConfig = useEthicsStore((s) => s.addConfig);
  const removeConfig = useEthicsStore((s) => s.removeConfig);

  const [content, setContent] = useState<string>("");

  const config = configs.find((c) => c.agentId === agentId) || null;

  // Fetch ethics content, configs, and conflicts on mount
  useEffect(() => {
    fetchEthics()
      .then(setContent)
      .catch(console.error);
    fetchConfigs().catch(console.error);
    fetchConflicts().catch(console.error);
  }, [fetchEthics, fetchConfigs, fetchConflicts]);

  const update = (updates: Partial<EthicsConfig>) => {
    if (config) updateConfig(config.id, updates);
  };

  const save = async (newContent: string) => {
    await saveEthics(newContent);
    setContent(newContent);
  };

  return {
    config,
    conflicts,
    content,
    isLoading,
    error,
    update,
    addConfig,
    removeConfig,
    save,
  };
}
