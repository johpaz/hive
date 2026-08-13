/**
 * redact-binary — last-line-of-defense redaction for stray base64 blobs.
 *
 * mcp-result-normalizer.ts (agent/mcp-result-normalizer.ts) is the real fix:
 * it intercepts MCP image/audio/resource content blocks before they ever
 * reach a string. This utility is the safety net for whatever slips past
 * that — a producer that isn't MCP, a content shape normalizeMcpResult
 * doesn't recognize, etc. Never rely on this alone to keep binaries out of
 * the LLM context.
 */

const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
const LONG_BASE64_RE = /[A-Za-z0-9+/]{1000,}={0,2}/g;

export function redactBinaryStrings(text: string): string {
  return text.replace(DATA_URI_RE, "[REDACTED_BINARY]").replace(LONG_BASE64_RE, "[REDACTED_BINARY]");
}
