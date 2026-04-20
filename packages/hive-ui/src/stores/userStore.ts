import { create } from "zustand";
import { apiClient } from "@/lib/api";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

interface User {
    id: string;
    name: string;
    language?: string;
    timezone?: string;
    occupation?: string;
    notes?: string;
    created_at?: number;
}

interface UserState {
    isLoading: boolean;
    currentUser: User | null;
    error: string | null;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    fetchUser: () => Promise<User | null>;
    saveUser: (updates: Partial<User>) => Promise<string>;
}

export const useUserStore = create<UserState>((set, get) => ({
    isLoading: false,
    currentUser: null,
    error: null,

    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),

    fetchUser: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ users: User[] }>("/api/users");
            const users = data.users || [];

            // Use existing user or null
            const user = users[0] || null;
            set({ currentUser: user, isLoading: false });
            return user;
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to fetch user profile"
            });
            return null;
        }
    },

    saveUser: async (updates: Partial<User>): Promise<string> => {
        const currentUser = get().currentUser;
        if (!currentUser) throw new Error("No user to update");

        set({ isLoading: true, error: null });
        try {
            const data = await apiClient<{ message?: string; error?: string }>(`/api/user/settings?userId=${currentUser.id}`, {
                method: "PATCH",
                body: updates,
            });

            // Refresh local state
            set({
                currentUser: { ...currentUser, ...updates },
                isLoading: false
            });
            return data.message || "Perfil guardado correctamente";
        } catch (error) {
            set({
                isLoading: false,
                error: error instanceof Error ? error.message : "Failed to save user profile"
            });
            throw error;
        }
    },
}));
