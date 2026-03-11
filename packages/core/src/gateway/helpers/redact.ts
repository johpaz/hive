import type { Config } from "../../config/loader.ts";

/**
 * Redacts a sensitive value by showing only the first 4 characters.
 * @param value - The value to redact
 * @returns The redacted value or a string of bullets if too short
 */
export function redactValue(value: string): string {
  if (!value || value.length < 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••`;
}

/**
 * Redacts sensitive information from a config object for safe exposure.
 * @param cfg - The config object to redact
 * @returns A new config object with sensitive values redacted
 */
export function redactConfig(cfg: Config): Record<string, unknown> {
  const redacted = JSON.parse(JSON.stringify(cfg)) as any;

  // Redact gateway authToken
  if (redacted.gateway?.authToken) {
    redacted.gateway.authToken = redactValue(redacted.gateway.authToken);
  }

  // Redact provider API keys
  if (redacted.models?.providers) {
    for (const provider of Object.values(redacted.models.providers) as any[]) {
      if (provider?.apiKey) provider.apiKey = redactValue(provider.apiKey);
    }
  }

  // Redact channel tokens
  if (redacted.channels) {
    for (const channel of Object.values(redacted.channels) as any[]) {
      if (channel?.accounts) {
        for (const acc of Object.values(channel.accounts) as any[]) {
          if (acc?.botToken) acc.botToken = redactValue(acc.botToken);
          if (acc?.appToken) acc.appToken = redactValue(acc.appToken);
          if (acc?.signingSecret) acc.signingSecret = redactValue(acc.signingSecret);
        }
      }
    }
  }

  // Redact MCP server headers
  if (redacted.mcp?.servers) {
    for (const server of Object.values(redacted.mcp.servers) as any[]) {
      if (server?.headers) {
        for (const [k, v] of Object.entries(server.headers)) {
          const lk = k.toLowerCase();
          if (lk.includes("auth") || lk.includes("token") || lk.includes("key")) {
            server.headers[k] = redactValue(v as string);
          }
        }
      }
    }
  }

  return redacted;
}
