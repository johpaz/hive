import { spawn, type ChildProcess } from "child_process";
import { BaseChannel, type ChannelConfig, type IncomingMessage, type OutboundMessage } from "../channels/base.ts";
import { logger } from "../utils/logger.ts";
import { pairingService } from "./pairing.ts";

export interface SignalConfig extends ChannelConfig {
  phoneNumber: string;
  dataDir?: string;
  signalCliPath?: string;
}

interface SignalMessage {
  envelope: {
    source: string;
    sourceNumber?: string;
    sourceName?: string;
    timestamp: number;
    dataMessage?: {
      message?: string;
      expiresInSeconds?: number;
    };
    syncMessage?: {
      sentMessage?: {
        destination?: string;
        message?: string;
      };
    };
  };
}

export class SignalChannel extends BaseChannel {
  name = "signal";
  accountId: string;
  config: SignalConfig;

  private signalCli?: ChildProcess;
  private log = logger.child("signal");
  private messageBuffer = "";
  private chatIdCache: Map<string, string> = new Map();

  constructor(accountId: string, config: SignalConfig) {
    super();
    this.accountId = accountId;
    this.config = {
      ...config,
      dmPolicy: config.dmPolicy ?? "pairing",
      allowFrom: config.allowFrom ?? [],
      enabled: config.enabled ?? true,
    };
  }

  async start(): Promise<void> {
    if (!this.config.phoneNumber) {
      throw new Error("Signal phone number not configured");
    }

    const signalCliPath = this.config.signalCliPath ?? "signal-cli";
    const dataDir = this.config.dataDir;

    const args = ["daemon", "--system"];
    if (dataDir) {
      args.push("--config", dataDir);
    }

    this.log.info(`Starting signal-cli: ${signalCliPath} ${args.join(" ")}`);

    this.signalCli = spawn(signalCliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.signalCli.stdout?.on("data", (data: Buffer) => {
      this.handleSignalOutput(data.toString());
    });

    this.signalCli.stderr?.on("data", (data: Buffer) => {
      this.log.error(`signal-cli stderr: ${data.toString()}`);
    });

    this.signalCli.on("error", (error: Error) => {
      this.log.error(`signal-cli error: ${error.message}`);
    });

    this.signalCli.on("exit", (code, signal) => {
      this.log.warn(`signal-cli exited with code ${code}, signal ${signal}`);
      this.running = false;
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.running = true;
    this.log.info(`Signal channel started for ${this.config.phoneNumber}`);
  }

  private handleSignalOutput(output: string): void {
    this.messageBuffer += output;

    const lines = this.messageBuffer.split("\n");
    this.messageBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        this.parseSignalMessage(line);
      }
    }
  }

  private parseSignalMessage(line: string): void {
    try {
      const data: SignalMessage = JSON.parse(line);

      if (data.envelope?.dataMessage?.message) {
        const from = data.envelope.source;
        const content = data.envelope.dataMessage.message;
        const timestamp = data.envelope.timestamp;

        this.handleIncomingMessage({
          from,
          content,
          timestamp,
          name: data.envelope.sourceName,
        });
      }
    } catch {
      this.log.debug(`Non-JSON output: ${line.slice(0, 100)}`);
    }
  }

  private async handleIncomingMessage(msg: {
    from: string;
    content: string;
    timestamp: number;
    name?: string;
  }): Promise<void> {
    const peerId = msg.from;
    const kind = "direct";

    if (msg.content === "/myid") {
      await this.sendDirectMessage(
        peerId,
        `🆔 Tu Signal ID es: ${peerId}\n\n` +
          `Para emparejar, usa el comando:\n` +
          `\`hive pairing generate signal ${peerId}\``
      );
      return;
    }

    if (msg.content === "/pair" || msg.content.startsWith("/pair ")) {
      const code = msg.content.split(" ")[1]?.trim();

      if (!code) {
        await this.sendDirectMessage(
          peerId,
          "🔐 Envía /pair CODIGO para emparejar.\n" +
            "Solicita un código de emparejamiento al administrador."
        );
        return;
      }

      const result = pairingService.approve(code);
      if (result.success) {
        await this.sendDirectMessage(peerId, "✅ ¡Emparejamiento exitoso! Ya puedes usar el bot.");
      } else {
        await this.sendDirectMessage(peerId, `❌ ${result.error}`);
      }
      return;
    }

    if (this.config.dmPolicy === "pairing" && !pairingService.isAllowed("signal", peerId)) {
      this.log.debug(`Message from unpaired user: ${peerId}`);
      await this.sendDirectMessage(
        peerId,
        "⛔ No estás emparejado.\n\n" +
          "Tu Signal ID: " + peerId + "\n\n" +
          "Solicita un código de emparejamiento al administrador y envíalo con:\n" +
          "/pair CODIGO"
      );
      return;
    }

    if (!this.isUserAllowed(peerId)) {
      this.log.debug(`Message from unauthorized user: ${peerId}`);
      return;
    }

    const sessionId = this.formatSessionId(peerId, kind);
    this.chatIdCache.set(sessionId, peerId);

    const incomingMessage: IncomingMessage = {
      sessionId,
      channel: "signal",
      accountId: this.accountId,
      peerId,
      peerKind: kind,
      content: msg.content,
      metadata: {
        signal: {
          phoneNumber: peerId,
          name: msg.name,
          timestamp: msg.timestamp,
        },
      },
    };

    await this.handleMessage(incomingMessage);
  }

  async stop(): Promise<void> {
    if (this.signalCli) {
      this.signalCli.kill("SIGTERM");
      this.running = false;
      this.log.info("Signal channel stopped");
    }
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    const content = message.content ?? "";

    if (!content || content.trim().length === 0) {
      this.log.warn("Empty response, skipping send");
      return;
    }

    const phoneNumber = this.chatIdCache.get(sessionId) ?? this.extractPhoneFromSession(sessionId);

    if (!phoneNumber) {
      throw new Error(`Cannot determine phone number for session: ${sessionId}`);
    }

    await this.sendDirectMessage(phoneNumber, content);
  }

  private async sendDirectMessage(phoneNumber: string, content: string): Promise<void> {
    const chunks = this.chunkMessage(content, 2000);

    for (const chunk of chunks) {
      await this.executeCli([
        "send",
        "-a", this.config.phoneNumber,
        "-m", chunk,
        phoneNumber,
      ]);

      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  private async executeCli(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const signalCliPath = this.config.signalCliPath ?? "signal-cli";
      const fullArgs = this.config.dataDir
        ? ["--config", this.config.dataDir, ...args]
        : args;

      const proc = spawn(signalCliPath, fullArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`signal-cli failed: ${stderr || stdout}`));
        }
      });

      proc.on("error", (error) => {
        reject(error);
      });
    });
  }

  private extractPhoneFromSession(sessionId: string): string | undefined {
    const parts = sessionId.split(":");
    return parts[4];
  }

  private chunkMessage(content: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitPoint = remaining.lastIndexOf("\n\n", maxLength);
      if (splitPoint === -1 || splitPoint < maxLength * 0.5) {
        splitPoint = remaining.lastIndexOf("\n", maxLength);
      }
      if (splitPoint === -1 || splitPoint < maxLength * 0.5) {
        splitPoint = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitPoint === -1 || splitPoint < maxLength * 0.5) {
        splitPoint = maxLength;
      }

      chunks.push(remaining.slice(0, splitPoint));
      remaining = remaining.slice(splitPoint).trim();
    }

    return chunks;
  }
}

export function createSignalChannel(accountId: string, config: SignalConfig): SignalChannel {
  return new SignalChannel(accountId, config);
}
