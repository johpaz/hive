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
    const base = filter === "all" ? allAgents : allAgents.filter((a) => a.status === filter);
    // Exclude hivelearn agents (hl-*) from the main agents list
    return base.filter((a: any) => !a.id?.startsWith("hl-"));
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
