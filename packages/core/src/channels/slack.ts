import { App, ExpressReceiver, type SlashCommand } from "@slack/bolt";
import type { ChannelConfig, IncomingMessage, OutboundMessage } from "./base.ts";
import { BaseChannel } from "./base.ts";
import { logger } from "../utils/logger.ts";
import { getDb } from "../storage/sqlite.ts";

export interface SlackConfig extends ChannelConfig {
  accountId?: string;
  botToken: string;
  appToken?: string; // only needed for Socket Mode — not used in HTTP webhook mode
  signingSecret: string;
  port?: number;
}

export interface SlackConnectionState {
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
}

export class SlackChannel extends BaseChannel {
  name = "slack";
  accountId: string;
  config: SlackConfig;

  private app: App | null = null;
  private connectionState: SlackConnectionState = {
    status: "disconnected",
  };
  private log = logger.child("slack");
  private pendingMessages: Map<string, { ts: string; channel: string }> = new Map();

  constructor(config: SlackConfig) {
    super();
    this.config = config;
    // Prefer explicit accountId from config; fall back to extracting from token
    if (config.accountId) {
      this.accountId = config.accountId;
    } else {
      const extracted = config.botToken?.split(":")[0]?.replace("xoxb-", "") ?? "";
      this.accountId = extracted || "slack";
    }
  }

  async start(): Promise<void> {
    this.running = true;
    this.connectionState.status = "connecting";

    this.log.warn(`
╔══════════════════════════════════════════════════════════════════╗
║  SLACK CHANNEL SETUP REQUIREMENT                                  ║
║                                                                  ║
║  Slack requires a PUBLIC URL for webhooks.                       ║
║  For local development, use one of:                              ║
║                                                                  ║
║  1. ngrok:     ngrok http 3000                                   ║
║  2. Tailscale: tailscale fun                                     ║
║  3. cloudflared tunnel --url http://localhost:3000               ║
║                                                                  ║
║  Then configure in Slack App settings:                           ║
║  - Request URL: https://your-tunnel-url/slack/events            ║
╚══════════════════════════════════════════════════════════════════╝
`);

    try {
      const receiver = new ExpressReceiver({
        signingSecret: this.config.signingSecret,
        endpoints: "/slack/events",
        processBeforeResponse: true,
      });

      this.app = new App({
        token: this.config.botToken,
        receiver,
      });

      this.app.event("app_mention", async ({ event }) => {
        await this.handleMention(event);
      });

      this.app.event("message", async ({ event }) => {
        if ((event as any).channel_type === "im") {
          await this.handleDirectMessage(event as any);
        }
      });

      this.app.command("/ai", async ({ command, ack }) => {
        await ack();
        await this.handleSlashCommand(command);
      });

      const port = this.config.port ?? 3000;

      await this.app.start(port);

      this.connectionState.status = "connected";
      this.log.info(`Slack channel started on port ${port}`);
      try {
        getDb().query(`UPDATE channels SET status = 'connected' WHERE id = ?`).run(this.accountId);
      } catch { /* ignore DB errors */ }

    } catch (error) {
      this.connectionState.status = "error";
      this.connectionState.error = (error as Error).message;
      this.log.error(`Slack connection error: ${(error as Error).message}`);
      try {
        getDb().query(`UPDATE channels SET status = 'error' WHERE id = ?`).run(this.accountId);
      } catch { /* ignore DB errors */ }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.app) {
      try {
        await this.app.stop();
      } catch {
        // Ignore close errors
      }
      this.app = null;
    }

    this.connectionState.status = "disconnected";
    this.log.info("Slack channel stopped");
    try {
      getDb().query(`UPDATE channels SET status = 'disconnected' WHERE id = ?`).run(this.accountId);
    } catch { /* ignore DB errors */ }
  }

  private async handleMention(event: { user?: string; text?: string; channel?: string; ts?: string; files?: Array<{ url_private?: string; mimetype?: string; name?: string }> }): Promise<void> {
    if (!event.user || !event.channel) return;

    const content = event.text?.replace(/<@[A-Z0-9]+>/g, "").trim() || "";

const audioFile = event.files?.find(f =>
f.mimetype?.startsWith("audio/") ||
f.name?.endsWith(".mp3") ||
f.name?.endsWith(".wav") ||
f.name?.endsWith(".ogg") ||
f.name?.endsWith(".webm")
);

const imageFile = event.files?.find(f =>
f.mimetype?.startsWith("image/") ||
f.name?.endsWith(".jpg") || f.name?.endsWith(".jpeg") ||
f.name?.endsWith(".png") || f.name?.endsWith(".gif") || f.name?.endsWith(".webp")
);

const docFile = !audioFile && !imageFile
? event.files?.find(f => f.mimetype?.startsWith("application/") || f.name?.endsWith(".pdf") || f.name?.endsWith(".doc") || f.name?.endsWith(".txt"))
: undefined;

const incoming: IncomingMessage = {
sessionId: this.formatSessionId(event.channel, "group"),
channel: "slack",
accountId: this.accountId,
peerId: event.channel,
peerKind: "group",
content,
audio: audioFile?.url_private ? { url: audioFile.url_private, mimeType: audioFile.mimetype || "audio/webm" } : undefined,
image: imageFile?.url_private ? { url: imageFile.url_private, mimeType: imageFile.mimetype || "image/png" } : undefined,
document: docFile?.url_private ? { url: docFile.url_private, mimeType: docFile.mimetype || "application/octet-stream", fileName: docFile.name } : undefined,
metadata: {
userId: event.user,
timestamp: event.ts,
files: event.files,
},
};

await this.handleMessage(incoming);
}

private async handleDirectMessage(event: { user?: string; text?: string; channel?: string; ts?: string; files?: Array<{ url_private?: string; mimetype?: string; name?: string }> }): Promise<void> {
if (!event.user || !event.channel) return;
if (event.text?.startsWith("/")) return;

const audioFile = event.files?.find(f =>
f.mimetype?.startsWith("audio/") ||
f.name?.endsWith(".mp3") ||
f.name?.endsWith(".wav") ||
f.name?.endsWith(".ogg") ||
f.name?.endsWith(".webm")
);

const imageFile = event.files?.find(f =>
f.mimetype?.startsWith("image/") ||
f.name?.endsWith(".jpg") || f.name?.endsWith(".jpeg") ||
f.name?.endsWith(".png") || f.name?.endsWith(".gif") || f.name?.endsWith(".webp")
);

const docFile = !audioFile && !imageFile
? event.files?.find(f => f.mimetype?.startsWith("application/") || f.name?.endsWith(".pdf") || f.name?.endsWith(".doc") || f.name?.endsWith(".txt"))
: undefined;

const incoming: IncomingMessage = {
sessionId: this.formatSessionId(event.user, "direct"),
channel: "slack",
accountId: this.accountId,
peerId: event.user,
peerKind: "direct",
content: event.text || "",
audio: audioFile?.url_private ? { url: audioFile.url_private, mimeType: audioFile.mimetype || "audio/webm" } : undefined,
image: imageFile?.url_private ? { url: imageFile.url_private, mimeType: imageFile.mimetype || "image/png" } : undefined,
document: docFile?.url_private ? { url: docFile.url_private, mimeType: docFile.mimetype || "application/octet-stream", fileName: docFile.name } : undefined,
metadata: {
channel: event.channel,
timestamp: event.ts,
files: event.files,
},
};

await this.handleMessage(incoming);
  }

  private async handleSlashCommand(command: SlashCommand): Promise<void> {
    const incoming: IncomingMessage = {
      sessionId: this.formatSessionId(command.user_id, "direct"),
      channel: "slack",
      accountId: this.accountId,
      peerId: command.user_id,
      peerKind: "direct",
      content: command.text,
      metadata: {
        channelId: command.channel_id,
        command: command.command,
        triggerId: command.trigger_id,
      },
    };

    await this.handleMessage(incoming);
  }

  async startTyping(sessionId: string): Promise<void> {
    if (!this.app) return;

    const peerId = this.extractPeerId(sessionId);

    try {
      const result = await this.app.client.chat.postMessage({
        channel: peerId,
        text: "⏳ Procesando...",
      });

      if (result.ts && result.channel) {
        this.pendingMessages.set(sessionId, { ts: result.ts as string, channel: result.channel as string });
      }
    } catch (error) {
      this.log.debug(`Could not send typing placeholder: ${(error as Error).message}`);
    }
  }

  async stopTyping(_sessionId: string): Promise<void> {
    // No-op for Slack - we edit the message in send()
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    if (!this.app) {
      throw new Error("Slack not connected");
    }

    const text = message.content ?? message.chunk ?? "";
    if (!text) return;

    const peerId = this.extractPeerId(sessionId);
    const pending = this.pendingMessages.get(sessionId);

    try {
      if (pending) {
        await this.app.client.chat.update({
          channel: pending.channel,
          ts: pending.ts,
          text,
        });
        this.pendingMessages.delete(sessionId);
      } else {
        await this.app.client.chat.postMessage({
          channel: peerId,
          text,
        });
      }

      this.log.debug(`Sent message to ${peerId}`);
    } catch (error) {
      this.log.error(`Failed to send Slack message: ${(error as Error).message}`);
      throw error;
    }
  }

  async sendAudio(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    if (!this.app) {
      throw new Error("Slack not connected");
    }

    const peerId = this.extractPeerId(sessionId);

    try {
      await this.app.client.files.uploadV2({
        channel_id: peerId,
        file: audio,
        filename: `response.${mimeType === "audio/mpeg" ? "mp3" : "webm"}`,
        title: "Voice response",
      });
      this.log.debug(`Sent audio to ${peerId}`);
    } catch (error) {
      this.log.error(`Failed to send Slack audio: ${(error as Error).message}`);
      throw error;
    }
  }

  private extractPeerId(sessionId: string): string {
    const parts = sessionId.split(":");
    return parts[parts.length - 1] ?? "";
  }

  getState(): SlackConnectionState {
    return { ...this.connectionState };
  }
}

export function createSlackChannel(config: SlackConfig): SlackChannel {
  return new SlackChannel(config);
}
