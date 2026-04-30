import { getApiBaseUrl } from "@/lib/gateway-url";
const API_BASE_URL = getApiBaseUrl();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  const fetchOpts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(requireAuth && token ? { "Authorization": `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }

  // Retry on network errors (gateway may still be starting up)
  let response: Response | null = null
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(`${API_BASE_URL}${endpoint}`, fetchOpts)
      break
    } catch (err) {
      // TypeError: Failed to fetch = network error (CORS, connection refused, gateway starting)
      if (attempt < MAX_RETRIES) {
        await sleep((attempt + 1) * 2000)
      } else {
        if (showLoader) useLoaderStore.getState().hideLoader()
        throw err
      }
    }
  }
  response = response!

  if (showLoader) {
    useLoaderStore.getState().hideLoader();
  }


  if (!response.ok) {
    // 401: token inválido/expirado → limpiar y redirigir al login
    if (response.status === 401 && typeof window !== "undefined" && !endpoint.startsWith("/api/auth/") && window.location.pathname !== "/login") {
      localStorage.removeItem("hive-auth-token");
      window.location.href = "/login";
      throw new Error("No autorizado");
    }

    // 503: gateway still starting up — never show a dialog, just throw silently
    if (response.status === 503) {
      throw new Error(`API Error: 503 Service Unavailable`);
    }

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
