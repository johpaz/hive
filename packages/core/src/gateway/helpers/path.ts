import * as path from "node:path";
import { homedir } from "node:os";

/**
 * Expands a path that starts with ~ to the user's home directory.
 * @param p - The path to expand
 * @returns The expanded path
 */
export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(homedir(), p.slice(1));
  }
  return p;
}
