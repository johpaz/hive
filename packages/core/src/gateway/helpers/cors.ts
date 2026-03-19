// CORS helper for Vite dev server (port 5173)
export const CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"];

/**
 * Adds CORS headers to a response for allowed origins.
 * @param response - The response to add headers to
 * @param request - The request to get the origin from
 * @returns The response with CORS headers added
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get("Origin");
  if (!origin) return response;

  // Allow any localhost origin for development
  const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("0.0.0.0");
  const isCorsOrigin = CORS_ORIGINS.some(o => origin.includes(o.replace("http://", "")));

  if (isCorsOrigin || isLocalhost) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Max-Age", "86400");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}
