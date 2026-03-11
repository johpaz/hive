import http, { type IncomingMessage, type ServerResponse, type Server } from "http";
import { BaseChannel, type ChannelConfig, type IncomingMessage as HiveIncomingMessage, type OutboundMessage } from "../channels/base.ts";
import { logger } from "../utils/logger.ts";
import { pairingService } from "./pairing.ts";

export interface GoogleChatConfig extends ChannelConfig {
  projectId?: string;
  serviceAccountKey?: string;
  webhookPort?: number;
  webhookPath?: string;
}

interface GoogleChatEvent {
  type: string;
  eventTime: string;
  space: {
    name: string;
    displayName: string;
    type: "ROOM" | "DM";
  };
  message?: {
    name: string;
    sender: {
      name: string;
      displayName: string;
    };
    createTime: string;
    text: string;
    thread?: {
      name: string;
    };
  };
  user?: {
    name: string;
    displayName: string;
  };
}

export class GoogleChatChannel extends BaseChannel {
  name = "google-chat";
  accountId: string;
  config: GoogleChatConfig;

  private server?: Server;
  private log = logger.child("google-chat");
  private spaceCache: Map<string, { space: string; thread?: string }> = new Map();

  constructor(accountId: string, config: GoogleChatConfig) {
    super();
    this.accountId = accountId;
    this.config = {
      ...config,
      dmPolicy: config.dmPolicy ?? "pairing",
      allowFrom: config.allowFrom ?? [],
      enabled: config.enabled ?? true,
      webhookPort: config.webhookPort ?? 8080,
      webhookPath: config.webhookPath ?? "/webhook/google-chat",
    };
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.url === this.config.webhookPath && req.method === "POST") {
        this.handleWebhook(req, res);
      } else {
        res.writeHead(404).end();
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.webhookPort, () => {
        this.running = true;
        this.log.info(
          `Google Chat webhook listening on port ${this.config.webhookPort}${this.config.webhookPath}`
        );
        resolve();
      });

      this.server!.on("error", (error: Error) => {
        this.log.error(`Server error: ${error.message}`);
        reject(error);
      });
    });
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const event: GoogleChatEvent = JSON.parse(body);

        if (event.type === "ADDED_TO_SPACE") {
          await this.handleAddedToSpace(event, res);
          return;
        }

        if (event.type === "REMOVED_FROM_SPACE") {
          this.log.info(`Removed from space: ${event.space.name}`);
          res.writeHead(200).end();
          return;
        }

        if (event.type === "MESSAGE" && event.message) {
          await this.handleChatMessage(event, res);
          return;
        }

        res.writeHead(200).end();
      } catch (error) {
        this.log.error(`Webhook error: ${(error as Error).message}`);
        res.writeHead(500).end();
      }
    });
  }

  private async handleAddedToSpace(
    event: GoogleChatEvent,
    res: ServerResponse
  ): Promise<void> {
    const message =
      event.space.type === "DM"
        ? {
          text: "¡Hola! Soy tu asistente AI. Envía un mensaje para comenzar.",
        }
        : {
          text: "¡Gracias por añadirme al espacio! Mencióname con @bot para interactuar.",
        };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(message));
  }

  private async handleChatMessage(event: GoogleChatEvent, res: ServerResponse): Promise<void> {
    if (!event.message) {
      res.writeHead(200).end();
      return;
    }

    const userId = event.message.sender.name.split("/").pop() ?? "unknown";
    const spaceName = event.space.name;
    const isDM = event.space.type === "DM";
    const kind = isDM ? "direct" : "group";
    const peerId = isDM ? userId : `${spaceName}:${userId}`;

    if (event.message.text === "/myid") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          text: `🆔 Tu Google Chat ID es: ${userId}\n\nPara emparejar, solicita un código al administrador.`,
        })
      );
      return;
    }

    if (event.message.text.startsWith("/pair ")) {
      const code = event.message.text.split(" ")[1]?.trim();
      const result = pairingService.approve(code ?? "");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          text: result.success
            ? "✅ ¡Emparejamiento exitoso!"
            : `❌ ${result.error}`,
        })
      );
      return;
    }

    if (this.config.dmPolicy === "pairing" && !pairingService.isAllowed("google-chat", userId)) {
      this.log.debug(`Message from unpaired user: ${userId}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          text:
            "⛔ No estás emparejado.\n\n" +
            "Tu ID: " +
            userId +
            "\n\n" +
            "Solicita un código de emparejamiento al administrador.",
        })
      );
      return;
    }

    if (!isDM && !this.isUserAllowed(peerId)) {
      this.log.debug(`Message from unauthorized user: ${peerId}`);
      res.writeHead(200).end();
      return;
    }

    const sessionId = this.formatSessionId(peerId, kind);
    this.spaceCache.set(sessionId, {
      space: spaceName,
      thread: event.message.thread?.name,
    });

    const incomingMessage: HiveIncomingMessage = {
      sessionId,
      channel: "google-chat",
      accountId: this.accountId,
      peerId,
      peerKind: kind,
      content: event.message.text,
      metadata: {
        googleChat: {
          spaceName,
          userId,
          displayName: event.message.sender.displayName,
          threadName: event.message.thread?.name,
        },
      },
    };

    res.writeHead(200).end();

    await this.handleMessage(incomingMessage);
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.running = false;
          this.log.info("Google Chat channel stopped");
          resolve();
        });
      });
    }
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    const content = message.content ?? "";

    if (!content || content.trim().length === 0) {
      this.log.warn("Empty response, skipping send");
      return;
    }

    const cached = this.spaceCache.get(sessionId);

    if (!cached) {
      this.log.warn(`No cached space for session: ${sessionId}`);
      return;
    }

    if (message.type === "stream" && message.chunk) {
      this.log.info(`[Google Chat] Stream chunk to ${cached.space}: ${message.chunk.slice(0, 50)}...`);
      return;
    }

    this.log.info(`[Google Chat] Would send to ${cached.space}: ${content.slice(0, 100)}...`);
  }

  async sendMessage(space: string, content: string, thread?: string): Promise<void> {
    this.log.info(`[Google Chat] Sending to ${space}: ${content.slice(0, 100)}...`);
    if (thread) {
      this.log.info(`  Thread: ${thread}`);
    }
  }
}

export function createGoogleChatChannel(
  accountId: string,
  config: GoogleChatConfig
): GoogleChatChannel {
  return new GoogleChatChannel(accountId, config);
}
