import { useAgentConfigStore } from "@/stores/agentConfigStore";

export function useAgentConfig() {
  const activeAgentId = useAgentConfigStore((s) => s.activeAgentId);
  const activeSection = useAgentConfigStore((s) => s.activeSection);
  const saveStatus = useAgentConfigStore((s) => s.saveStatus);
  const unsavedChanges = useAgentConfigStore((s) => s.unsavedChanges);
  const validationErrors = useAgentConfigStore((s) => s.validationErrors);
  const setActiveAgent = useAgentConfigStore((s) => s.setActiveAgent);
  const setActiveSection = useAgentConfigStore((s) => s.setActiveSection);
  const setSaveStatus = useAgentConfigStore((s) => s.setSaveStatus);
  const setUnsavedChanges = useAgentConfigStore((s) => s.setUnsavedChanges);

  return {
    activeAgentId,
    activeSection,
    saveStatus,
    unsavedChanges,
    validationErrors,
    setActiveAgent,
    setActiveSection,
    setSaveStatus,
    setUnsavedChanges,
  };
}
