import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../logger";

export interface SSETransportConfig {
  url: string;                        // URL base
  headers?: Record<string, string>;
}

export class SSETransport implements Transport {
  private baseUrl: string;
  private messagesUrl: string | null = null; // Endpoint recibido del servidor

  private headers: Record<string, string>;
  private abortController: AbortController | null = null;
  private cookies: string[] = [];
  private startResolve: (() => void) | null = null;
  private startReject: ((err: Error) => void) | null = null;
  sessionId?: string;

  onmessage: ((message: unknown) => void) | undefined;
  onerror: ((error: Error) => void) | undefined;
  onclose: (() => void) | undefined;

  constructor(config: SSETransportConfig) {
    this.baseUrl = config.url;
    this.headers = config.headers ?? {};
  }

  async start(): Promise<void> {
    this.abortController = new AbortController();

    return new Promise(async (resolve, reject) => {
      // Timeout fallback: if no endpoint received in 5s, continue anyway
      const timeout = setTimeout(() => {
        this.startResolve = null;
        this.startReject = null;
        resolve();
      }, 5000);

      this.startResolve = () => {
        clearTimeout(timeout);
        this.startResolve = null;
        this.startReject = null;
        resolve();
      };

      this.startReject = (err) => {
        clearTimeout(timeout);
        this.startResolve = null;
        this.startReject = null;
        reject(err);
      };

      try {
        logger.debug(`[SSE] Connecting to: ${this.baseUrl}`);
        const response = await fetch(this.baseUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json, text/event-stream",
            "Cache-Control": "no-cache",
            ...this.headers,
          },
          signal: this.abortController!.signal,
        });

        if (response.status === 405) {
          logger.debug(`[SSE] GET not allowed (405), falling back to Streamable HTTP pattern for ${this.baseUrl}`);
          this.startResolve();
          return;
        }

        if (!response.ok) {
          this.startReject(new Error(`MCP SSE connection failed: ${response.status} ${response.statusText}`));
          return;
        }

        this.readSessionId(response);

        if (response.body) {
          this.startReading(response.body);
        } else {
          this.startResolve();
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          this.startReject(error);
        }
      }
    });
  }

  private readSessionId(response: Response) {
    const sessionId = response.headers.get("x-session-id") ??
      response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    // Track cookies for session affinity (important for n8n/proxies)
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      // Simple cookie extraction: just keep the keys and values
      const newCookies = setCookie.split(',').map(c => c.split(';')[0].trim());
      this.cookies = [...new Set([...this.cookies, ...newCookies])];
    }
  }

  private startReading(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    this.processStream(reader, decoder, buffer).catch((error) => {
      if (this.onerror && error.name !== "AbortError") {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async processStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    buffer: string
  ): Promise<void> {
    try {
      let eventType = "message";
      let eventData = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data.trim() === "[DONE]") {
              this.onclose?.();
              return;
            }
            eventData += data + "\n";
          } else if (line === "") {
            if (eventData) {
              eventData = eventData.trim();
              if (eventType === "endpoint") {
                try {
                  this.messagesUrl = new URL(eventData, this.baseUrl).href;
                  logger.debug(`[SSE] Messages endpoint received: ${this.messagesUrl}`);
                  this.startResolve?.();
                } catch (e) {
                  logger.warn(`[SSE] Failed to parse endpoint: ${eventData}`);
                }
              } else if (eventType === "message" || eventType === "") {
                try {
                  const parsed = JSON.parse(eventData);
                  this.onmessage?.(parsed);
                } catch {
                  // Ignorar heartbeats o no-JSON
                }
              }
              eventData = "";
            }
            eventType = "message";
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async close(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.sessionId = undefined;
    this.onclose?.();
  }

  async send(message: unknown): Promise<void> {
    if (!this.abortController) {
      throw new Error("SSE transport not started — llama start() primero");
    }

    const targetUrl = this.messagesUrl || this.baseUrl;
    let url = targetUrl;

    if (this.sessionId && !url.includes(`sessionId=${this.sessionId}`)) {
      url = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}sessionId=${this.sessionId}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...this.headers,
        ...(this.cookies.length > 0 ? { "Cookie": this.cookies.join('; ') } : {}),
      },
      body: JSON.stringify(message),
      signal: this.abortController.signal,
    });

    this.readSessionId(response);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`MCP message failed (${response.status}): ${body || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream") && response.body) {
      this.startReading(response.body);
    }
    else if (contentType.includes("application/json")) {
      const text = await response.text();
      if (text.trim()) {
        try {
          this.onmessage?.(JSON.parse(text));
        } catch {
          // ignored
        }
      }
    }
  }
}

export function createSSETransport(config: SSETransportConfig): Transport {
  return new SSETransport(config) as unknown as Transport;
}