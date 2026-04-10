/**
 * fetch wrapper that attaches the Hive auth token (Bearer) when available.
 * Reads the same localStorage key ("hive-auth-token") used by hive-ui's apiClient.
 */
export function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("hive-auth-token") : null;

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(input, { ...init, headers });
}
