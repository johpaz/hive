import type { Config } from "../config/loader.ts"
import type { Tool } from "../tools/types.ts"
import * as filesystem from "../tools/filesystem/index.ts"
import { webSearchTool } from "../tools/web/web-search.ts"
import { webFetchTool } from "../tools/web/web-fetch.ts"
import * as cli from "../tools/cli/index.ts"
import * as office from "../tools/office/index.ts"
import * as api from "../tools/api/index.ts"

/**
 * Reconstruct only stateless tools inside worker realms.
 *
 * Importing the complete tool registry pulls process-local services (including
 * HiveDB) into tool-worker.js even though those tools are always executed by
 * RPC on the main thread. Keeping this registry explicit makes the worker
 * bundle platform-neutral and prevents native bindings from leaking into it.
 */
export function createWorkerTools(_config: Config): Tool[] {
  return [
    ...filesystem.createTools(),
    webSearchTool,
    webFetchTool,
    ...cli.createTools(),
    ...office.createTools(),
    ...api.createTools(),
  ]
}
