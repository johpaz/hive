declare global {
  interface Window { __HIVE_CONFIG__?: { apiUrl: string; wsUrl: string } }
}

const _runtime = typeof window !== "undefined" ? window.__HIVE_CONFIG__ : undefined;
const _apiUrl = _runtime?.apiUrl || import.meta.env.VITE_API_URL || "";
const _wsUrl  = _runtime?.wsUrl  || import.meta.env.VITE_WS_URL  || "";
const _isLocalhostUrl = (url: string) => /localhost|127\.0\.0\.1/.test(url);
const _onLocalhost    = /localhost|127\.0\.0\.1/.test(window.location.hostname);

/** Base HTTP URL para API calls. "" = mismo origen (URL relativa) */
export function getApiBaseUrl(): string {
  if (_apiUrl && (!_isLocalhostUrl(_apiUrl) || _onLocalhost)) return _apiUrl;
  return "";
}

/** Base WS URL (ws:// o wss://) para WebSocket connections */
export function getWsBaseUrl(): string {
  if (_wsUrl && (!_isLocalhostUrl(_wsUrl) || _onLocalhost)) return _wsUrl;
  const api = getApiBaseUrl();
  if (api) return api.replace(/^http/, "ws");
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}
