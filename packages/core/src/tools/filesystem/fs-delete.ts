/**
 * fs_delete - Delete file or directory from workspace
 * 
 * @category filesystem
 * @seedId fs_delete
 * @spanish eliminar archivo, borrar archivo, borrar carpeta
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace } from "./workspace-guard.ts";
import * as fs from "node:fs";

const log = logger.child("fs-delete");

export const fsDeleteTool: Tool = {
  name: "fs_delete",
  description: "Delete file or directory from workspace. Spanish: eliminar archivo, borrar archivo, borrar carpeta",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file or directory to delete",
      },
      recursive: {
        type: "boolean",
        description: "Delete recursively for directories (default: false)",
      },
    },
    required: ["path"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const workspace = getWorkspace(config);
    let targetPath: string;
    try {
      targetPath = resolveInWorkspace(params.path as string, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const recursive = (params.recursive as boolean) ?? false;

    log.debug(`Deleting: ${targetPath}`);

    try {
      if (!fs.existsSync(targetPath)) {
        return {
          ok: false,
          error: `Path not found: ${targetPath}`,
        };
      }

      const stats = fs.statSync(targetPath);

      if (stats.isDirectory()) {
        if (recursive) {
          fs.rmSync(targetPath, { recursive: true });
        } else {
          fs.rmdirSync(targetPath);
        }
      } else {
        fs.unlinkSync(targetPath);
      }

      return {
        ok: true,
        path: targetPath,
        deleted: true,
      };
    } catch (error) {
      log.error(`Error deleting: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to delete: ${(error as Error).message}`,
      };
    }
  },
};
