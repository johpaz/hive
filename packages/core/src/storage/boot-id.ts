/**
 * boot-id — a unique id generated on every process start so that durable
 * leases (agentRuns / jobQueue) can detect which rows belong to a dead
 * process after a crash/restart.
 *
 * The id is a short hex string; it is stable for the lifetime of the
 * process and can be passed to {@link reconcileOnBoot}.
 */

import { randomBytes } from "node:crypto";

let currentBootId: string | null = null;

export function getBootId(): string {
  if (!currentBootId) {
    currentBootId = randomBytes(8).toString("hex");
  }
  return currentBootId;
}

export function resetBootId(): void {
  currentBootId = null;
}