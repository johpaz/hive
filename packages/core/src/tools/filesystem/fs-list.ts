/**
 * fs_list - List files and directories in workspace
 * 
 * @category filesystem
 * @seedId fs_list
 * @spanish listar archivos, ver carpeta, explorar directorio
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace, expandPath } from "./workspace-guard.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const log = logger.child("fs-list");

export const fsListTool: Tool = {
  name: "fs_list",
  description: "List files and directories in workspace. Spanish: listar archivos, ver carpeta, explorar directorio",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the directory to list (default: current directory)",
      },
      recursive: {
        type: "boolean",
        description: "List recursively (default: false)",
      },
      maxDepth: {
        type: "number",
        description: "Maximum depth for recursive listing (default: 3)",
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const workspace = getWorkspace(config);
    // Default to workspace root when no path given and workspace is configured
    const rawPath = (params.path as string) ?? (workspace ? expandPath(workspace) : ".");
    let dirPath: string;
    try {
      dirPath = resolveInWorkspace(rawPath, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const recursive = (params.recursive as boolean) ?? false;
    const maxDepth = (params.maxDepth as number) ?? 3;

    log.debug(`Listing directory: ${dirPath}`);

    try {
      if (!fs.existsSync(dirPath)) {
        return {
          ok: false,
          error: `Directory not found: ${dirPath}`,
        };
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return {
          ok: false,
          error: `Not a directory: ${dirPath}`,
        };
      }

      interface FileEntry {
        name: string;
        type: "file" | "directory";
        path: string;
        size?: number;
        modified?: string;
        children?: FileEntry[];
      }

      function listDir(dir: string, depth: number): FileEntry[] {
        if (depth > maxDepth) return [];

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.map((entry) => {
          const fullPath = path.join(dir, entry.name);
          const result: FileEntry = {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            path: fullPath,
          };

          if (entry.isDirectory() && recursive && depth < maxDepth) {
            try {
              const subStats = fs.statSync(fullPath);
              result.size = subStats.size;
              result.modified = subStats.mtime.toISOString();
              result.children = listDir(fullPath, depth + 1);
            } catch {
              // Ignore permission errors
            }
          } else {
            try {
              const subStats = fs.statSync(fullPath);
              result.size = subStats.size;
              result.modified = subStats.mtime.toISOString();
            } catch {
              // Ignore permission errors
            }
          }

          return result;
        });
      }

      const entries = listDir(dirPath, 0);

      return {
        ok: true,
        path: dirPath,
        entries,
        count: entries.length,
      };
    } catch (error) {
      log.error(`Error listing directory: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to list directory: ${(error as Error).message}`,
      };
    }
  },
};
