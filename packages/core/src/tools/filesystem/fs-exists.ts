/**
 * fs_exists - Check if a file or directory exists
 * 
 * @category filesystem
 * @seedId fs_exists
 * @spanish verificar archivo, comprobar, existe archivo
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace } from "./workspace-guard.ts";
import * as fs from "node:fs";

const log = logger.child("fs-exists");

export const fsExistsTool: Tool = {
  name: "fs_exists",
  description: "Check if a file or directory exists. Spanish: verificar archivo, comprobar, existe archivo",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to check for existence",
      },
    },
    required: ["path"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const workspace = getWorkspace(config);
    let filePath: string;
    try {
      filePath = resolveInWorkspace(params.path as string, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    log.debug(`Checking existence: ${filePath}`);

    try {
      const exists = fs.existsSync(filePath);
      let type: "file" | "directory" | "none" = "none";

      if (exists) {
        const stats = fs.statSync(filePath);
        type = stats.isDirectory() ? "directory" : "file";
      }

      return {
        ok: true,
        path: filePath,
        exists,
        type,
      };
    } catch (error) {
      log.error(`Error checking existence: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to check existence: ${(error as Error).message}`,
      };
    }
  },
};
