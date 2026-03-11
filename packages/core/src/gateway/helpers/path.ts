import * as path from "node:path";

/**
 * Expands a path that starts with ~ to the user's home directory.
 * @param p - The path to expand
 * @returns The expanded path
 */
export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(process.env.HOME ?? "", p.slice(1));
  }
  return p;
}
