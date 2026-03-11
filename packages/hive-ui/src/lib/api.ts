const API_BASE_URL = import.meta.env.VITE_API_URL || "";
import { useLoaderStore } from "@/stores/useLoaderStore";
import { swal } from "@/lib/swal";


interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  requireAuth?: boolean;
  showLoader?: boolean | string;
  showError?: boolean;
  showSuccess?: boolean | string | ((data: any) => boolean | string);
}

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    requireAuth = true,
    showLoader = false,
    showError = true,
    showSuccess = false
  } = options;

  if (showLoader) {
    const message = typeof showLoader === "string" ? showLoader : "Procesando...";
    useLoaderStore.getState().showLoader(message);
  }

  // Get token from localStorage if available
  const token = typeof window !== "undefined" ? localStorage.getItem("hive-auth-token") : null;

  console.log(`[API] ${method} ${endpoint}`, {
    hasToken: !!token,
    tokenPreview: token ? token.slice(0, 20) + "..." : null,
    requireAuth
  });

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(requireAuth && token ? { "Authorization": `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (showLoader) {
    useLoaderStore.getState().hideLoader();
  }


  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.message || errorData.error) {
        errorMessage = errorData.message || errorData.error;
      }
    } catch { /* ignore parse error */ }
    if (showError) {
      swal.fire({
        title: "Error de Sistema",
        text: errorMessage,
        icon: "error"
      });
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (showSuccess) {
    let message: string | boolean = "Operación exitosa";

    if (typeof showSuccess === "function") {
      message = showSuccess(data);
    } else if (typeof showSuccess === "string") {
      message = showSuccess;
    }

    if (message !== false) {
      swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: typeof message === "string" ? message : "Operación exitosa",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      });
    }
  }

  return data;
}
