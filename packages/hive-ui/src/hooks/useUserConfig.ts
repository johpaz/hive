import { useUserConfigStore } from "@/stores/userConfigStore";
import type { UserConfig } from "@/types";

export function useUserConfig(agentId: string) {
  const configs = useUserConfigStore((s) => s.configs);
  const updateConfig = useUserConfigStore((s) => s.updateConfig);
  const addConfig = useUserConfigStore((s) => s.addConfig);
  const removeConfig = useUserConfigStore((s) => s.removeConfig);

  const config = configs.find((c) => c.agentId === agentId) || null;

  const update = (updates: Partial<UserConfig>) => {
    if (config) updateConfig(config.id, updates);
  };

  return { config, update, addConfig, removeConfig };
}
