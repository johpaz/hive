import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// CORRECCIÓN 1 — quitar extensión .ts de los imports
// Bun resuelve los módulos sin extensión correctamente
// Con .ts puede fallar en algunos contextos de build/bundle
import { SSETransport, type SSETransportConfig } from "./sse";
import { WebSocketTransport, type WebSocketTransportConfig } from "./websocket";

export { SSETransport, type SSETransportConfig };
export { WebSocketTransport, type WebSocketTransportConfig };

// CORRECCIÓN 2 — exportar StdioTransportConfig
// Estaba definido pero no exportado — el resto del código no puede importarlo
export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Streamable HTTP: el transporte remoto ESTÁNDAR de MCP hoy.
 *
 * No es lo mismo que `sse`. Aquel es el transporte HTTP+SSE original, de dos
 * endpoints (un GET que abre el stream y un POST aparte para enviar), que la
 * especificación reemplazó por éste: un único endpoint que acepta POST y
 * devuelve JSON o un stream SSE según haga falta.
 *
 * Sin este caso, un servidor MCP remoto moderno es inalcanzable: no expone el
 * `/sse` de dos endpoints que espera `SSETransport` y la conexión muere en un
 * 404.
 */
export interface HttpTransportConfig {
  /** URL del endpoint MCP, normalmente terminado en `/mcp`. */
  url: string;
  /** Cabeceras extra en cada petición — típicamente la autorización. */
  headers?: Record<string, string>;
  /** Sesión previa a reanudar, si el servidor emitió un id de sesión. */
  sessionId?: string;
}

export type TransportType = "stdio" | "sse" | "websocket" | "http";

export interface TransportOptions {
  type: TransportType;
  stdio?: StdioTransportConfig;
  sse?: SSETransportConfig;
  websocket?: WebSocketTransportConfig;
  http?: HttpTransportConfig;
}

export function createTransport(options: TransportOptions): Transport {
  switch (options.type) {
    case "stdio": {
      if (!options.stdio) {
        throw new Error("stdio config required for stdio transport");
      }
      return new StdioClientTransport({
        command: options.stdio.command,
        args: options.stdio.args ?? [],
        env: options.stdio.env ?? (process.env as Record<string, string>),
      });
    }

    case "sse": {
      if (!options.sse) {
        throw new Error("sse config required for SSE transport");
      }
      // CORRECCIÓN 3 — sin cast as unknown as Transport
      // SSETransport ahora implementa Transport directamente (implements Transport)
      // el cast doble era señal de que el tipo no estaba bien declarado en la clase
      return new SSETransport(options.sse);
    }

    case "websocket": {
      if (!options.websocket) {
        throw new Error("websocket config required for WebSocket transport");
      }
      // Igual — WebSocketTransport ahora implementa Transport directamente
      return new WebSocketTransport(options.websocket);
    }

    case "http": {
      if (!options.http) {
        throw new Error("http config required for Streamable HTTP transport");
      }
      // La implementación la pone el SDK oficial de MCP, que ya es dependencia
      // nuestra: no hay nada que reescribir acá, sólo faltaba el caso.
      let url: URL;
      try {
        url = new URL(options.http.url);
      } catch {
        throw new Error(`Invalid MCP endpoint URL: ${options.http.url}`);
      }
      return new StreamableHTTPClientTransport(url, {
        requestInit: options.http.headers ? { headers: options.http.headers } : undefined,
        sessionId: options.http.sessionId,
      });
    }

    default: {
      // exhaustive check — TypeScript avisa si falta un caso
      const _exhaustive: never = options.type;
      throw new Error(`Unknown transport type: ${_exhaustive}`);
    }
  }
}