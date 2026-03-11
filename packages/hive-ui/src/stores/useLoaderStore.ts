import { create } from "zustand";

interface LoaderState {
    isLoading: boolean;
    message?: string;
    showLoader: (message?: string) => void;
    hideLoader: () => void;
}

export const useLoaderStore = create<LoaderState>((set) => ({
    isLoading: false,
    message: undefined,
    showLoader: (message) => set({ isLoading: true, message }),
    hideLoader: () => set({ isLoading: false, message: undefined }),
}));

// Helper for non-react usage if needed (e.g. in utils)
export const loader = {
    show: (message?: string) => useLoaderStore.getState().showLoader(message),
    hide: () => useLoaderStore.getState().hideLoader(),
};
