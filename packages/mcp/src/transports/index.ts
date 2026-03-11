import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

export type TransportType = "stdio" | "sse" | "websocket";

export interface TransportOptions {
  type: TransportType;
  stdio?: StdioTransportConfig;
  sse?: SSETransportConfig;
  websocket?: WebSocketTransportConfig;
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

    default: {
      // exhaustive check — TypeScript avisa si falta un caso
      const _exhaustive: never = options.type;
      throw new Error(`Unknown transport type: ${_exhaustive}`);
    }
  }
}