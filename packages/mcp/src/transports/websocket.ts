import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface WebSocketTransportConfig {
  url: string;
  headers?: Record<string, string>;
  reconnect?: boolean;        // reconectar automáticamente si se cae (default: true)
  reconnectDelay?: number;    // ms entre intentos de reconexión (default: 3000)
  reconnectMaxAttempts?: number; // máximo de intentos (default: 10)
}

export class WebSocketTransport implements Transport {
  private url: string;
  private ws: WebSocket | null = null;
  private headers?: Record<string, string>;
  private intentionallyClosed = false;  // distingue close() manual de caída
  private reconnectAttempts = 0;
  private reconnectDelay: number;
  private reconnectMaxAttempts: number;
  private shouldReconnect: boolean;

  onmessage: ((message: unknown) => void) | undefined;
  onerror: ((error: Error) => void) | undefined;
  onclose: (() => void) | undefined;

  constructor(config: WebSocketTransportConfig) {
    this.url = config.url;
    this.headers = config.headers;
    this.shouldReconnect = config.reconnect ?? true;
    this.reconnectDelay = config.reconnectDelay ?? 3000;
    this.reconnectMaxAttempts = config.reconnectMaxAttempts ?? 10;
  }

  async start(): Promise<void> {
    this.intentionallyClosed = false;
    this.reconnectAttempts = 0;
    return this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {

      // CORRECCIÓN 1 — headers en Bun WebSocket
      // Bun acepta las opciones como segundo argumento cuando no hay subprotocols,
      // o como objeto con `headers` dentro de un array de subprotocols vacío.
      // La forma más segura y compatible:
      const ws = this.headers && Object.keys(this.headers).length > 0
        ? new WebSocket(this.url, {
          // @ts-expect-error — Bun extiende la API estándar de WebSocket
          headers: this.headers,
        })
        : new WebSocket(this.url);

      this.ws = ws;
      let resolved = false;

      ws.onopen = () => {
        resolved = true;
        this.reconnectAttempts = 0; // reset contador al conectar exitosamente
        resolve();
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);
          this.onmessage?.(data);
        } catch {
          // Ignorar mensajes no-JSON (ping/pong, heartbeats)
        }
      };

      // CORRECCIÓN 2 — separar el error de conexión del error post-conexión
      ws.onerror = (event: Event) => {
        const error =
          (event as ErrorEvent).error ??
          new Error(`WebSocket error en ${this.url}`);

        if (!resolved) {
          // Error durante la conexión inicial → rechazar la promesa
          reject(error);
        } else {
          // Error después de conectar → notificar sin rechazar
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
      };

      // CORRECCIÓN 3 — reconexión automática en cierre inesperado
      ws.onclose = (event: CloseEvent) => {
        this.ws = null;

        if (this.intentionallyClosed) {
          // Cierre manual con close() — notificar y no reconectar
          this.onclose?.();
          return;
        }

        if (!resolved) {
          // Cierre antes de que se abriera → rechazar la promesa
          reject(new Error(
            `WebSocket cerrado antes de conectar — code: ${event.code}, reason: ${event.reason}`
          ));
          return;
        }

        // Cierre inesperado después de conectar
        if (
          this.shouldReconnect &&
          this.reconnectAttempts < this.reconnectMaxAttempts
        ) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * this.reconnectAttempts; // backoff lineal

          setTimeout(async () => {
            try {
              await this.connect();
            } catch (err) {
              this.onerror?.(err instanceof Error ? err : new Error(String(err)));
              this.onclose?.();
            }
          }, delay);
        } else {
          // Sin más intentos → notificar cierre definitivo
          this.onerror?.(new Error(
            `WebSocket desconectado después de ${this.reconnectAttempts} intentos — ${this.url}`
          ));
          this.onclose?.();
        }
      };
    });
  }

  async close(): Promise<void> {
    this.intentionallyClosed = true; // marcar como cierre intencional
    if (this.ws) {
      // Código 1000 = cierre normal
      this.ws.close(1000, "Client closed connection");
      this.ws = null;
    }
  }

  async send(message: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `WebSocket no está conectado — readyState: ${this.ws?.readyState ?? "null"}`
      );
    }
    this.ws.send(JSON.stringify(message));
  }

  // Útil para health checks desde el MCP client
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export function createWebSocketTransport(
  config: WebSocketTransportConfig
): Transport {
  return new WebSocketTransport(config) as unknown as Transport;
}