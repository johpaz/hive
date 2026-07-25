import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Logger,
  onLogEntry,
  removeLogListener,
  type LogEntry,
} from "../packages/core/src/utils/logger";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("logger durability and redaction", () => {
  test("appends ordered entries instead of overwriting the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-logger-"));
    dirs.push(dir);
    const logger = new Logger({ dir, console: false });

    logger.info("first-entry");
    logger.info("second-entry");

    const file = join(dir, readdirSync(dir).find((name) => name.endsWith(".log"))!);
    const contents = readFileSync(file, "utf8");
    expect(contents).toContain("first-entry");
    expect(contents).toContain("second-entry");
    expect(contents.indexOf("first-entry")).toBeLessThan(contents.indexOf("second-entry"));
  });

  test("redacts secrets and base64 in file and live subscribers", () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-logger-"));
    dirs.push(dir);
    const logger = new Logger({ dir, console: false, redactSensitive: true });
    const entries: LogEntry[] = [];
    const listener = (entry: LogEntry) => entries.push(entry);
    onLogEntry(listener);

    try {
      logger.info(
        `tool output data:image/png;base64,${"A".repeat(600)}`,
        { apiKey: "top-secret", screenshot: "B".repeat(600), safe: "visible" },
      );
    } finally {
      removeLogListener(listener);
    }

    const file = join(dir, readdirSync(dir).find((name) => name.endsWith(".log"))!);
    const contents = readFileSync(file, "utf8");
    expect(contents).not.toContain("top-secret");
    expect(contents).not.toContain("A".repeat(100));
    expect(contents).not.toContain("B".repeat(100));
    expect(contents).toContain("[REDACTED]");
    expect(entries[0]?.message).not.toContain("A".repeat(100));
    expect(entries[0]?.meta?.apiKey).toBe("[REDACTED]");
    expect(entries[0]?.meta?.screenshot).toBe("[REDACTED]");
    expect(entries[0]?.meta?.safe).toBe("visible");
  });
});
