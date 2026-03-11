/**
 * fs_read - Read file content from agent workspace
 * 
 * @category filesystem
 * @seedId fs_read
 * @spanish leer archivo, ver contenido, abrir archivo
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace } from "./workspace-guard.ts";

const log = logger.child("fs-read");

export const fsReadTool: Tool = {
  name: "fs_read",
  description: "Read file content from agent workspace. Spanish: leer archivo, ver contenido, abrir archivo",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed, default: 1)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read (default: 2000)",
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
    const offset = (params.offset as number) ?? 1;
    const limit = (params.limit as number) ?? 2000;

    log.debug(`Reading file: ${filePath}`);

    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");

      const start = Math.max(0, offset - 1);
      const end = Math.min(lines.length, start + limit);
      const selected = lines.slice(start, end);

      return {
        ok: true,
        path: filePath,
        content: selected.map((line, i) => `${start + i + 1}: ${line}`).join("\n"),
        totalLines: lines.length,
        linesRead: selected.length,
      };
    } catch (error) {
      log.error(`Error reading file: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to read file: ${(error as Error).message}`,
      };
    }
  },
};
