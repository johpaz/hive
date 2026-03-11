/**
 * Workspace Guard — enforces that filesystem tool paths stay inside the agent workspace.
 *
 * If the agent has no workspace configured the guard is a no-op and all paths are allowed.
 * If a workspace is set, any path that resolves outside it is rejected with a clear error.
 */

import * as path from "node:path"
import * as os from "node:os"

/** Expand ~ to the home directory */
export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

/**
 * Resolve a user-supplied path against the workspace root.
 *
 * - If `workspace` is not set (null / undefined / empty), all paths pass through unchanged.
 * - Relative paths are resolved relative to `workspace`.
 * - Absolute paths must be inside `workspace`; otherwise an error is thrown.
 *
 * @throws Error when the resolved path is outside the workspace.
 */
export function resolveInWorkspace(
  filePath: string,
  workspace: string | null | undefined
): string {
  if (!workspace) {
    // No workspace configured — allow any path
    return filePath
  }

  const wsRoot = path.resolve(expandPath(workspace))

  let resolved: string
  if (path.isAbsolute(filePath)) {
    resolved = path.normalize(filePath)
  } else {
    resolved = path.resolve(wsRoot, filePath)
  }

  // Ensure the resolved path is inside the workspace
  const relative = path.relative(wsRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `[Workspace] Access denied: '${filePath}' resolves outside workspace '${wsRoot}'.`
    )
  }

  return resolved
}

/**
 * Extract workspace from tool config (passed by agent-loop as config.configurable.workspace).
 */
export function getWorkspace(config?: any): string | null | undefined {
  return config?.configurable?.workspace ?? null
}
