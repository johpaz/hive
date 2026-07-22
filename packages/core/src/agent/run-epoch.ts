/**
 * Fixed-worker epoch (harness-engineering concept): the exact
 * provider/model/app-version/tool-catalog combination a run executed under.
 * A model or tool-catalog change is a requalification signal — proof
 * packets from different epochs shouldn't be compared as if the "worker"
 * were unchanged.
 */

import rootPackage from "../../../../package.json";

export interface RunEpoch {
  provider: string;
  model: string;
  app_version: string;
  tool_catalog_hash: string;
}

/** Stable non-cryptographic hash (djb2) over sorted tool names — a cheap fingerprint of the active tool catalog. */
function hashToolNames(names: string[]): string {
  const sorted = [...names].sort().join(",");
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) hash = ((hash * 33) ^ sorted.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

export function buildRunEpoch(opts: { provider: string; model: string; toolNames: string[] }): RunEpoch {
  return {
    provider: opts.provider,
    model: opts.model,
    app_version: (rootPackage as { version: string }).version,
    tool_catalog_hash: hashToolNames(opts.toolNames),
  };
}
