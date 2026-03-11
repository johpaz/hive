import { useAgentStore } from "@/stores/agentStore";
import { useEffect, useState, useMemo } from "react";

export function useAgents() {
  const {
    agents: allAgents,
    isLoading,
    error,
    fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent
  } = useAgentStore();
  const [filter, setFilter] = useState<string>("all");

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filteredAgents = useMemo(() => {
    if (!Array.isArray(allAgents)) return [];
    return filter === "all" ? allAgents : allAgents.filter((a) => a.status === filter);
  }, [allAgents, filter]);

  return {
    agents: filteredAgents,
    allAgents: allAgents || [],
    filter,
    setFilter,
    createAgent,
    updateAgent,
    deleteAgent,
    isLoading,
    error,
    refreshAgents: fetchAgents,
  };
}
