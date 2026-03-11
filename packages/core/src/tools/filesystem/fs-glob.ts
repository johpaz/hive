/**
 * fs_glob - Find files matching wildcard patterns
 * 
 * @category filesystem
 * @seedId fs_glob
 * @spanish buscar archivos, patrón, encontrar archivos
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace, expandPath } from "./workspace-guard.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("fs-glob");

export const fsGlobTool: Tool = {
  name: "fs_glob",
  description: "Find files matching wildcard patterns. Spanish: buscar archivos, patrón, encontrar archivos",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.js')",
      },
      basePath: {
        type: "string",
        description: "Base path to search from (default: current directory)",
      },
    },
    required: ["pattern"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const workspace = getWorkspace(config);
    const rawBase = (params.basePath as string) ?? (workspace ? expandPath(workspace) : ".");
    let base: string;
    try {
      base = resolveInWorkspace(rawBase, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const pattern = params.pattern as string;

    log.debug(`Globbing: ${pattern} in ${base}`);

    try {
      const results: string[] = [];

      function matchGlob(dir: string, pat: string, depth: number): void {
        if (depth > 10) return;

        const parts = pat.split("/");
        const firstPart = parts[0];
        const remainingParts = parts.slice(1);

        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (firstPart === "**") {
              if (entry.isDirectory()) {
                matchGlob(fullPath, parts.slice(1).join("/"), depth + 1);
                matchGlob(fullPath, pat, depth + 1);
              }
              if (remainingParts.length === 0 || matchesPattern(entry.name, remainingParts[0])) {
                results.push(fullPath);
              }
            } else if (matchesPattern(entry.name, firstPart)) {
              if (remainingParts.length === 0) {
                results.push(fullPath);
              } else if (entry.isDirectory()) {
                matchGlob(fullPath, remainingParts.join("/"), depth + 1);
              }
            }
          }
        } catch {
          // Ignore permission errors
        }
      }

      function matchesPattern(name: string, pattern: string): boolean {
        if (pattern === "*") return true;
        if (pattern === "**") return true;
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        return regex.test(name);
      }

      matchGlob(base, pattern, 0);

      return {
        ok: true,
        pattern,
        basePath: base,
        files: results.slice(0, 100),
        count: results.length,
      };
    } catch (error) {
      log.error(`Error globbing: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to glob: ${(error as Error).message}`,
      };
    }
  },
};
