/**
 * process-safety — last-resort net for exceptions nothing else caught.
 *
 * Confirmed by exhaustive grep: before this, packages/core/src had no
 * process.on("uncaughtException"/"unhandledRejection") handler anywhere.
 * Bun/Node's default behavior for a truly uncaught exception is to kill the
 * process immediately with just a stack trace on stdout — no attempt to
 * notify anyone, no clean shutdown.
 *
 * This does NOT try to keep the process alive after a fatal error — doing
 * that would mask real bugs and can leave the process in an inconsistent
 * state (leases not released, locks not freed). It only guarantees the crash
 * is loud (max-severity log line) and the shutdown is a clean, fast exit
 * instead of an undefined one. The rest of the story is handled by existing
 * machinery: reconcileOnBoot (storage/reconcile.ts) already notifies the user
 * for interrupted chat runs when the process comes back up, and the process
 * supervisor (systemd/pm2/docker) is expected to restart it.
 */

import { logger } from "../utils/logger";

const log = logger.child("process-safety");

let installed = false;

export function installProcessSafetyNet(): void {
  if (installed) return;
  installed = true;

  const handleFatal = (err: unknown, origin: string) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(`[process-safety] FATAL ${origin} — process exiting: ${detail}`);
    process.exit(1);
  };

  process.on("uncaughtException", (err) => handleFatal(err, "uncaughtException"));
  process.on("unhandledRejection", (err) => handleFatal(err, "unhandledRejection"));

  log.info("[process-safety] Installed uncaughtException/unhandledRejection safety net");
}
