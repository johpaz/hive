import { useCallback, useState } from "react";
import { apiClient } from "@/lib/api";
import type { Specialist } from "@/types/specialists";

export function useSpecialists() {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSpecialists = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient<{ specialists: Specialist[] }>("/api/specialists", { showError: false });
      setSpecialists(response.specialists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch specialists");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleSpecialist = useCallback(async (id: string, active: boolean) => {
    // Optimistic update — reverted on failure by the refetch in the catch block.
    setSpecialists((prev) => prev.map((s) => (s.id === id ? { ...s, active } : s)));
    try {
      await apiClient(`/api/specialists/${id}`, {
        method: "PATCH",
        body: { active },
        showError: true,
      });
    } catch (err) {
      await fetchSpecialists();
      throw err;
    }
  }, [fetchSpecialists]);

  return { specialists, isLoading, error, fetchSpecialists, toggleSpecialist };
}
